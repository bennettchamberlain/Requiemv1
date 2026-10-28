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
    this.concludeModel = 'llama3.2:3b',
    this.sessionTtl = const Duration(days: 7),
    this.agentUrl,
    this.agentToken,
    this.agentModel = 'openclaw/default',
    this.googleMapsApiKey,
    this.geocodeUserAgent = 'scoria-api (local)',
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
      concludeModel: e['SCORIA_CONCLUDE_MODEL'] ?? 'llama3.2:3b',
      agentUrl: e['SCORIA_AGENT_URL'],
      agentToken: e['SCORIA_AGENT_TOKEN'],
      agentModel: e['SCORIA_AGENT_MODEL'] ?? 'openclaw/default',
      googleMapsApiKey: _blankToNull(
        e['GOOGLE_MAPS_API_KEY'] ?? e['GEOCODING_API_KEY'],
      ),
      geocodeUserAgent:
          e['SCORIA_GEOCODE_USER_AGENT'] ?? 'scoria-api (self-hosted)',
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

  /// Small local model that reads a memory and proposes graph edges.
  /// Kept off the chat model so a conclusion does not evict the harness.
  final String concludeModel;
  final Duration sessionTtl;

  /// OpenAI-compatible agent harness (OpenClaw gateway by default:
  /// `http://127.0.0.1:18789`). Null disables `/chat`.
  final String? agentUrl;
  final String? agentToken;

  /// Agent target. For OpenClaw this is an agent id, not a provider model.
  final String agentModel;

  /// Google Geocoding key. Null means Nominatim (OpenStreetMap), which needs
  /// no key but is rate-limited to one request per second.
  final String? googleMapsApiKey;
  final String geocodeUserAgent;

  static String? _blankToNull(String? s) =>
      s == null || s.trim().isEmpty ? null : s.trim();

  static String _defaultQueriesDir() {
    // server/scoria_api -> repo root -> schema/queries
    final here = Directory.current.path;
    return '$here/../../schema/queries';
  }
}
