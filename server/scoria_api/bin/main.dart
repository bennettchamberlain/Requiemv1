import 'dart:io';

import 'package:postgres/postgres.dart';
import 'package:scoria_api/scoria_api.dart';
import 'package:scoria_api/src/embeddings.dart';
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
  );

  final server = await io.serve(
    app.handler,
    InternetAddress.anyIPv4,
    config.port,
  );
  stdout.writeln(
    'scoria-api on :${server.port} '
    '(gel=${config.gelDsn}, pgboss=${jobs != null}, '
    'embeddings=${app.embeddings != null}, queries=${queries.names.length})',
  );

  ProcessSignal.sigint.watch().listen((_) async {
    await server.close(force: true);
    await db.close();
    exit(0);
  });
}
