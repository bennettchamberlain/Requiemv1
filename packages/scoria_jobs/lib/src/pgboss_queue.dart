import 'dart:convert';

import 'package:postgres/postgres.dart';
import 'package:scoria_jobs/src/job.dart';

/// Queue operations against the pg-boss 10 schema.
///
/// SQL follows `plans.js` in pg-boss 10.3.2: `fetchNextJob`, `completeJobs`,
/// `failJobs` (including retry/backoff math), `insertJob`, `createQueue`.
class PgBossQueue {
  const PgBossQueue(this.pool, {this.schema = 'pgboss'});

  final Pool pool;
  final String schema;

  /// Idempotent. Creates the queue row and its job partition.
  Future<void> createQueue(
    String name, [
    QueueOptions options = const QueueOptions(),
  ]) {
    return pool.execute(
      Sql.named('select $schema.create_queue(@name, @opts::json)'),
      parameters: {'name': name, 'opts': jsonEncode(options.toJson())},
    );
  }

  /// Enqueues one job. Returns the job id, or null when a singleton policy
  /// deduplicated it.
  Future<String?> send(
    String name,
    Map<String, dynamic> data, [
    SendOptions o = const SendOptions(),
  ]) async {
    final r = await pool.execute(
      Sql.named(_insertJob),
      parameters: {
        'id': o.id,
        'name': name,
        'data': jsonEncode(data),
        'priority': o.priority,
        'start_after': o.startAfter == null
            ? null
            : '${o.startAfter!.inSeconds} seconds',
        'singleton_key': o.singletonKey,
        'expire_in': o.expireIn == null
            ? null
            : '${o.expireIn!.inSeconds} seconds',
        'retry_limit': o.retryLimit,
        'retry_delay': o.retryDelay?.inSeconds,
        'retry_backoff': o.retryBackoff,
      },
    );
    return r.isEmpty ? null : r.first[0] as String;
  }

  /// Claims up to [batchSize] jobs with `FOR UPDATE SKIP LOCKED`.
  Future<List<Job>> fetch(String name, {int batchSize = 1}) async {
    final r = await pool.execute(
      Sql.named(_fetchNextJob),
      parameters: {'name': name, 'n': batchSize},
    );
    return r.map((row) {
      final m = row.toColumnMap();
      return Job(
        id: m['id'] as String,
        name: m['name'] as String,
        data: (m['data'] as Map<String, dynamic>?) ?? const {},
        expireIn: Duration(seconds: _num(m['expire_in_seconds'], 900).round()),
        retryCount: (m['retry_count'] as int?) ?? 0,
      );
    }).toList();
  }

  static num _num(Object? v, num fallback) => switch (v) {
    final num n => n,
    final String s => num.tryParse(s) ?? fallback,
    _ => fallback,
  };

  Future<int> complete(String name, String id, [Object? output]) async {
    final r = await pool.execute(
      Sql.named(_completeJobs),
      parameters: {
        'name': name,
        'ids': [id],
        'output': output == null ? null : jsonEncode(output),
      },
    );
    return (r.first[0] as int?) ?? 0;
  }

  /// Fails the job. pg-boss semantics: retry with delay/backoff until
  /// `retry_limit`, then `failed` (and dead-letter if the queue has one).
  Future<void> fail(String name, String id, Object error) async {
    await pool.execute(
      Sql.named(_failJobsById),
      parameters: {
        'name': name,
        'ids': [id],
        'output': jsonEncode({
          'value': {'message': error.toString()},
        }),
      },
    );
  }

  /// Moves `active` jobs past `expire_in` to retry/failed. Run periodically.
  Future<void> failExpired() => pool.execute(_failJobsByTimeout);

  // ---- SQL (pg-boss 10.3.2 plans.js) ---------------------------------------

  String get _fetchNextJob =>
      '''
    with next as (
      select id from $schema.job
      where name = @name and state < 'active' and start_after < now()
      order by priority desc, created_on, id
      limit @n
      for update skip locked
    )
    update $schema.job j set
      state = 'active',
      started_on = now(),
      retry_count = case when started_on is not null then retry_count + 1 else retry_count end
    from next
    where name = @name and j.id = next.id
    returning j.id, j.name, j.data, j.retry_count,
              extract(epoch from j.expire_in)::float8 as expire_in_seconds''';

  String get _completeJobs =>
      '''
    with results as (
      update $schema.job
      set completed_on = now(), state = 'completed', output = @output::jsonb
      where name = @name and id in (select unnest(@ids::uuid[])) and state = 'active'
      returning *
    )
    select count(*)::int from results''';

  String get _insertJob =>
      '''
    insert into $schema.job (
      id, name, data, priority, start_after, singleton_key, dead_letter,
      expire_in, keep_until, retry_limit, retry_delay, retry_backoff, policy
    )
    select
      id, j.name, data, priority, start_after, singleton_key, q.dead_letter,
      case
        when expire_in is not null then cast(expire_in as interval)
        when q.expire_seconds is not null then q.expire_seconds * interval '1s'
        else interval '15 minutes'
      end as expire_in,
      start_after + cast(coalesce((q.retention_minutes * 60)::text, '14 days') as interval) as keep_until,
      coalesce(j.retry_limit, q.retry_limit, 2) as retry_limit,
      case
        when coalesce(j.retry_backoff, q.retry_backoff, false)
        then greatest(coalesce(j.retry_delay, q.retry_delay), 1)
        else coalesce(j.retry_delay, q.retry_delay, 0)
      end as retry_delay,
      coalesce(j.retry_backoff, q.retry_backoff, false) as retry_backoff,
      q.policy
    from (
      select
        coalesce(@id::uuid, gen_random_uuid()) as id,
        @name::text as name,
        @data::jsonb as data,
        coalesce(@priority::int, 0) as priority,
        now() + cast(coalesce(@start_after::text, '0') as interval) as start_after,
        @singleton_key::text as singleton_key,
        @expire_in::text as expire_in,
        @retry_limit::int as retry_limit,
        @retry_delay::int as retry_delay,
        @retry_backoff::bool as retry_backoff
    ) j join $schema.queue q on j.name = q.name
    on conflict do nothing
    returning id''';

  String _failJobs(String where, String output) =>
      '''
    with deleted_jobs as (
      delete from $schema.job where $where returning *
    ),
    retried_jobs as (
      insert into $schema.job (
        id, name, priority, data, state, retry_limit, retry_count, retry_delay,
        retry_backoff, start_after, started_on, singleton_key, singleton_on,
        expire_in, created_on, completed_on, keep_until, dead_letter, policy, output
      )
      select
        id, name, priority, data,
        case when retry_count < retry_limit then 'retry'::$schema.job_state
             else 'failed'::$schema.job_state end as state,
        retry_limit, retry_count, retry_delay, retry_backoff,
        case
          when retry_count = retry_limit then start_after
          when not retry_backoff then now() + retry_delay * interval '1'
          else now() + (
            retry_delay * 2 ^ least(16, retry_count + 1) / 2 +
            retry_delay * 2 ^ least(16, retry_count + 1) / 2 * random()
          ) * interval '1'
        end as start_after,
        started_on, singleton_key, singleton_on, expire_in, created_on,
        case when retry_count < retry_limit then null else now() end as completed_on,
        keep_until, dead_letter, policy, $output
      from deleted_jobs
      on conflict do nothing
      returning *
    ),
    dlq_jobs as (
      insert into $schema.job (name, data, output, retry_limit, keep_until)
      select dead_letter, data, output, retry_limit, keep_until + (keep_until - start_after)
      from retried_jobs
      where state = 'failed' and dead_letter is not null and name <> dead_letter
    )
    select count(*)::int from retried_jobs''';

  String get _failJobsById => _failJobs(
    "name = @name and id in (select unnest(@ids::uuid[])) and state < 'completed'",
    '@output::jsonb',
  );

  String get _failJobsByTimeout => _failJobs(
    "state = 'active' and (started_on + expire_in) < now()",
    '''
        '{ "value": { "message": "job failed by timeout in active state" } }'::jsonb''',
  );
}
