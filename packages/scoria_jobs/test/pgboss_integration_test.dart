@Tags(['integration'])
library;

import 'dart:io';

import 'package:postgres/postgres.dart';
import 'package:scoria_jobs/scoria_jobs.dart';
import 'package:test/test.dart';

/// Runs only when SCORIA_PG_TEST_URL is set, e.g.
/// postgres://scoria:scoria@127.0.0.1:5433/scoria
void main() {
  final url = Platform.environment['SCORIA_PG_TEST_URL'];
  if (url == null) {
    test('skipped: SCORIA_PG_TEST_URL not set', () {});
    return;
  }

  late Pool pool;
  const schema = 'pgboss_test';
  late PgBossQueue q;

  setUpAll(() async {
    final u = Uri.parse(url);
    pool = Pool.withEndpoints(
      [
        Endpoint(
          host: u.host,
          port: u.port,
          database: u.pathSegments.first,
          username: u.userInfo.split(':').first,
          password: u.userInfo.split(':').last,
        ),
      ],
      settings: const PoolSettings(
        sslMode: SslMode.disable,
        maxConnectionCount: 4,
      ),
    );
    await pool.execute('drop schema if exists $schema cascade');
    await pool.run((s) => const PgBossSchema(schema: schema).install(s));
    q = PgBossQueue(pool, schema: schema);
  });

  tearDownAll(() async {
    await pool.execute('drop schema if exists $schema cascade');
    await pool.close();
  });

  test('install is idempotent', () async {
    await pool.run((s) => const PgBossSchema(schema: schema).install(s));
    final v = await pool.execute('select version from $schema.version');
    expect(v.first[0], pgBossSchemaVersion);
  });

  test('send, fetch, complete', () async {
    await q.createQueue('embed');
    final id = await q.send('embed', {'subject': 'abc'});
    expect(id, isNotNull);

    final jobs = await q.fetch('embed');
    expect(jobs.single.id, id);
    expect(jobs.single.data['subject'], 'abc');

    expect(
      await q.fetch('embed'),
      isEmpty,
      reason: 'claimed jobs are not refetched',
    );
    expect(await q.complete('embed', id!, {'ok': true}), 1);

    final row = await pool.execute(
      Sql.named('select state::text, output from $schema.job where id = @id'),
      parameters: {'id': id},
    );
    expect(row.first[0], 'completed');
  });

  test('fail retries with backoff then fails', () async {
    await q.createQueue(
      'flaky',
      const QueueOptions(
        retryLimit: 1,
        retryDelay: Duration(seconds: 0),
        retryBackoff: false,
      ),
    );
    final id = (await q.send('flaky', {}))!;

    var job = (await q.fetch('flaky')).single;
    await q.fail('flaky', job.id, 'boom');
    var state = await pool.execute(
      Sql.named('select state::text from $schema.job where id = @id'),
      parameters: {'id': id},
    );
    expect(state.first[0], 'retry');

    job = (await q.fetch('flaky')).single;
    expect(job.retryCount, 1);
    await q.fail('flaky', job.id, 'boom again');
    state = await pool.execute(
      Sql.named('select state::text from $schema.job where id = @id'),
      parameters: {'id': id},
    );
    expect(state.first[0], 'failed');
  });

  test('singleton policy dedupes', () async {
    await q.createQueue(
      'derive-presence',
      const QueueOptions(policy: QueuePolicy.stately),
    );
    final a = await q.send(
      'derive-presence',
      {},
      const SendOptions(singletonKey: 'p1'),
    );
    final b = await q.send(
      'derive-presence',
      {},
      const SendOptions(singletonKey: 'p1'),
    );
    expect(a, isNotNull);
    expect(b, isNull);
  });

  test('runner dispatches to handler', () async {
    final runner = JobRunner(
      q,
      pollInterval: const Duration(milliseconds: 100),
    );
    final seen = <String>[];
    await runner.work('hello', (job) async {
      seen.add(job.data['who'] as String);
      return {'greeted': true};
    });
    await runner.start();
    await q.send('hello', {'who': 'maya'});
    await Future<void>.delayed(const Duration(milliseconds: 600));
    await runner.stop();
    expect(seen, ['maya']);
  });
}
