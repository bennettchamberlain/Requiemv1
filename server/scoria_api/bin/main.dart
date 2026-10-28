import 'dart:io';

import 'package:postgres/postgres.dart';
import 'package:scoria_api/scoria_api.dart';
import 'package:scoria_jobs/scoria_jobs.dart';
import 'package:shelf/shelf_io.dart' as io;

Future<void> main() async {
  final config = Config.fromEnv();
  final db = Db.connect(config);
  final queries = await NamedQueries.load(config.queriesDir);

  PgBossQueue? jobs;
  if (config.pgUrl case final url?) {
    final u = Uri.parse(url);
    final pool = Pool.withEndpoints([
      Endpoint(
        host: u.host,
        port: u.port == 0 ? 5432 : u.port,
        database: u.pathSegments.first,
        username: u.userInfo.split(':').first,
        password: u.userInfo.split(':').last,
      ),
    ], settings: const PoolSettings(sslMode: SslMode.disable));
    await pool.run((s) => const PgBossSchema().install(s));
    jobs = PgBossQueue(pool);
    await jobs.createQueue('embed');
    await jobs.createQueue(
      'derive-presence',
      const QueueOptions(policy: QueuePolicy.stately),
    );
    await jobs.createQueue(
      'conclude',
      const QueueOptions(policy: QueuePolicy.singleton),
    );
  }

  JobRunner? runner;
  if (jobs != null && config.ollamaUrl != null) {
    final concluder = GraphConcluder(
      db: db,
      ollama: Uri.parse(config.ollamaUrl!),
      model: config.concludeModel,
    );
    runner = JobRunner(
      jobs,
      log: (message, [error]) {
        stdout.writeln(error == null ? message : '$message $error');
      },
    );
    await runner.work('conclude', concluder.run);
    await runner.start();
  }

  final app = ScoriaApp(
    config: config,
    db: db,
    queries: queries,
    jobs: jobs,
    embeddings: config.ollamaUrl == null
        ? null
        : Embeddings(
            baseUrl: Uri.parse(config.ollamaUrl!),
            model: config.embeddingModel,
          ),
    agent: config.agentUrl == null
        ? null
        : AgentClient(
            baseUrl: Uri.parse(config.agentUrl!),
            token: config.agentToken,
            model: config.agentModel,
          ),
  );

  final server = await io.serve(
    app.handler,
    InternetAddress.anyIPv4,
    config.port,
  );
  stdout.writeln(
    'scoria-api on :${server.port} '
    '(gel=${config.gelDsn}, pgboss=${jobs != null}, '
    'embeddings=${app.embeddings != null}, agent=${config.agentUrl ?? 'off'}, '
    'geocoder=${app.geocoder.provider}, queries=${queries.names.length})',
  );

  ProcessSignal.sigint.watch().listen((_) async {
    await runner?.stop();
    await server.close(force: true);
    await db.close();
    exit(0);
  });
}
