import 'dart:io';

/// Process configuration from the environment.
class Config {
  const Config({
    required this.port,
    required this.gelDsn,
    required this.gelTlsInsecure,
    required this.sessionSecret,
    required this.queriesDir,
    this.pgUrl,
    this.ollamaUrl,
    this.embeddingModel = 'nomic-embed-text',
    this.sessionTtl = const Duration(days: 7),
  });

  factory Config.fromEnv([Map<String, String>? env]) {
    final e = env ?? Platform.environment;
    final secret = e['SCORIA_SESSION_SECRET'];
    if (secret == null || secret.length < 32) {
      throw StateError(
        'SCORIA_SESSION_SECRET must be set to at least 32 characters',
      );
    }
    return Config(
      port: int.parse(e['SCORIA_PORT'] ?? '8080'),
      gelDsn: e['GEL_DSN'] ?? 'gel://admin@127.0.0.1:5656/main',
      gelTlsInsecure:
          (e['GEL_CLIENT_TLS_SECURITY'] ?? 'insecure') == 'insecure',
      sessionSecret: secret,
      queriesDir: e['SCORIA_QUERIES_DIR'] ?? _defaultQueriesDir(),
      pgUrl: e['SCORIA_PG_URL'],
      ollamaUrl: e['OLLAMA_URL'],
      embeddingModel: e['SCORIA_EMBEDDING_MODEL'] ?? 'nomic-embed-text',
    );
  }

  final int port;
  final String gelDsn;
  final bool gelTlsInsecure;
  final String sessionSecret;

  /// Directory holding the named `.edgeql` queries (`schema/queries`).
  final String queriesDir;

  /// Raw backend Postgres for PGBoss. Null disables job enqueueing.
  final String? pgUrl;

  /// Ollama base URL for embeddings. Null disables semantic search.
  final String? ollamaUrl;
  final String embeddingModel;
  final Duration sessionTtl;

  static String _defaultQueriesDir() {
    // server/scoria_api -> repo root -> schema/queries
    final here = Directory.current.path;
    return '$here/../../schema/queries';
  }
}
