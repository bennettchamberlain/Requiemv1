import 'dart:io';

import 'package:postgres/postgres.dart';
import 'package:scoria_api/scoria_api.dart';
import 'package:scoria_jobs/scoria_jobs.dart';
import 'package:shelf/shelf_io.dart' as io;

Future<void> main() async {
  final config = Config.fromEnv();
  final db = Db.connect(config);
  final queries = await NamedQueries.load(config.queriesDir);

  final cloud = config.parasailApiKey == null
      ? null
      : ParasailEmbeddings(
          apiKey: config.parasailApiKey!,
          model: config.parasailEmbedModel,
          baseUrl: config.parasailBaseUrl,
        );
  final local = config.ollamaUrl == null
      ? null
      : Embeddings(
          baseUrl: Uri.parse(config.ollamaUrl!),
          model: config.embeddingModel,
        );

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
    await jobs.createQueue(
      'etl',
      const QueueOptions(policy: QueuePolicy.singleton),
    );
    await jobs.createQueue(
      'weave',
      const QueueOptions(policy: QueuePolicy.singleton),
    );
  }

  JobRunner? runner;
  if (jobs != null) {
    runner = JobRunner(
      jobs,
      log: (message, [error]) {
        stdout.writeln(error == null ? message : '$message $error');
      },
    );
    await runner.work('embed', EmbedJob(db: db, local: local, cloud: cloud).run);
    if (config.ollamaUrl != null) {
      await runner.work(
        'conclude',
        GraphConcluder(
          db: db,
          ollama: Uri.parse(config.ollamaUrl!),
          model: config.concludeModel,
        ).run,
      );
    }
    final root = config.hackathonRoot ?? _guessHackathonRoot();
    final python = config.pythonBin;
    if (Directory('$root/etl').existsSync()) {
      await runner.work(
        'etl',
        PythonJob(python: python, module: 'etl.worker', workdir: root).run,
      );
    }
    if (Directory('$root/swarm').existsSync()) {
      await runner.work(
        'weave',
        PythonJob(python: python, module: 'swarm.weave', workdir: root).run,
      );
    }
    await runner.start();
  }

  final parasailChat = config.parasailApiKey == null
      ? null
      : AgentClient(
          baseUrl: Uri.parse(config.parasailBaseUrl),
          token: config.parasailApiKey,
          model: config.parasailChatModel,
        );
  final ollamaChat = config.ollamaUrl == null
      ? null
      : AgentClient(
          baseUrl: Uri.parse(config.ollamaUrl!),
          model: config.ollamaChatModel,
        );
  final gateway = config.agentUrl == null
      ? null
      : AgentClient(
          baseUrl: Uri.parse(config.agentUrl!),
          token: config.agentToken,
          model: config.agentModel,
        );

  final app = ScoriaApp(
    config: config,
    db: db,
    queries: queries,
    jobs: jobs,
    embeddings: local,
    cloudEmbeddings: cloud,
    parasailChat: parasailChat,
    ollamaChat: ollamaChat,
    agent: gateway,
  );

  final server = await io.serve(
    app.handler,
    InternetAddress.anyIPv4,
    config.port,
  );
  stdout.writeln(
    'scoria-api on :${server.port} '
    '(gel=${config.gelDsn}, pgboss=${jobs != null}, '
    'embeddings=${local != null}, cloud=${cloud != null}, '
    'chat=${app.defaultChatLabel}, '
    'geocoder=${app.geocoder.provider}, queries=${queries.names.length})',
  );

  ProcessSignal.sigint.watch().listen((_) async {
    await runner?.stop();
    await server.close(force: true);
    await db.close();
    exit(0);
  });
}

String _guessHackathonRoot() {
  final here = Directory.current.path;
  for (final root in [
    here,
    '$here/..',
    '$here/../..',
    '$here/../../..',
  ]) {
    if (Directory('$root/etl').existsSync() &&
        Directory('$root/swarm').existsSync()) {
      return root;
    }
  }
  return here;
}
