/// Pointer to a One Connect grant. The tokens stay at One.
class OneGrant {
  const OneGrant({
    required this.id,
    required this.oneUserId,
    required this.platforms,
    this.spaceId,
    this.connectedAt,
    this.revokedAt,
  });

  factory OneGrant.fromJson(Map<String, dynamic> json) => OneGrant(
    id: json['id'] as String,
    oneUserId: json['one_user_id'] as String,
    spaceId: json['space_id'] as String?,
    platforms: (json['platforms'] as List<dynamic>? ?? const [])
        .map((e) => e.toString())
        .toList(),
    connectedAt: json['connected_at'] == null
        ? null
        : DateTime.parse(json['connected_at'] as String),
    revokedAt: json['revoked_at'] == null
        ? null
        : DateTime.parse(json['revoked_at'] as String),
  );

  final String id;
  final String oneUserId;
  final String? spaceId;
  final List<String> platforms;
  final DateTime? connectedAt;
  final DateTime? revokedAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'one_user_id': oneUserId,
    'space_id': spaceId,
    'platforms': platforms,
    'connected_at': connectedAt?.toIso8601String(),
    'revoked_at': revokedAt?.toIso8601String(),
  };
}

/// Result of `POST /one/connect`. `local` means this Requiem recorded the
/// grant and queued ETL (fixtures when One keys are missing). `oauth`
/// means the client should open [authorizeUrl] on the same API host.
class OneConnectResult {
  const OneConnectResult({
    required this.mode,
    this.authorizeUrl,
    this.enqueued = const [],
    this.grant,
  });

  factory OneConnectResult.fromJson(Map<String, dynamic> json) =>
      OneConnectResult(
        mode: json['mode'] as String? ?? 'local',
        authorizeUrl: json['authorize_url'] as String?,
        enqueued: (json['enqueued'] as List<dynamic>? ?? const [])
            .map((e) => e.toString())
            .toList(),
        grant: json['grant'] == null
            ? null
            : OneGrant.fromJson(json['grant'] as Map<String, dynamic>),
      );

  final String mode;
  final String? authorizeUrl;
  final List<String> enqueued;
  final OneGrant? grant;

  bool get isOauth => mode == 'oauth';
}

class SyncCursor {
  const SyncCursor({
    required this.id,
    required this.platform,
    required this.endpoint,
    this.cursor,
    this.lastSyncedAt,
    this.lastError,
  });

  factory SyncCursor.fromJson(Map<String, dynamic> json) => SyncCursor(
    id: json['id'] as String,
    platform: json['platform'] as String,
    endpoint: json['endpoint'] as String,
    cursor: json['cursor'],
    lastSyncedAt: json['last_synced_at'] == null
        ? null
        : DateTime.parse(json['last_synced_at'] as String),
    lastError: json['last_error'] as String?,
  );

  final String id;
  final String platform;
  final String endpoint;
  final Object? cursor;
  final DateTime? lastSyncedAt;
  final String? lastError;

  Map<String, dynamic> toJson() => {
    'id': id,
    'platform': platform,
    'endpoint': endpoint,
    'cursor': cursor,
    'last_synced_at': lastSyncedAt?.toIso8601String(),
    'last_error': lastError,
  };
}
