/// A conversation with the agent harness, as returned by `chat_sessions`.
class ChatSession {
  const ChatSession({
    required this.id,
    required this.createdAt,
    this.title,
    this.lastMessageAt,
    this.messageCount = 0,
  });

  factory ChatSession.fromJson(Map<String, dynamic> json) => ChatSession(
    id: json['id'] as String,
    title: json['title'] as String?,
    createdAt: DateTime.parse(json['created_at'] as String),
    lastMessageAt: json['last_message_at'] == null
        ? null
        : DateTime.parse(json['last_message_at'] as String),
    messageCount: (json['message_count'] as num?)?.toInt() ?? 0,
  );

  final String id;
  final String? title;
  final DateTime createdAt;
  final DateTime? lastMessageAt;
  final int messageCount;

  ChatSession copyWith({
    String? title,
    DateTime? lastMessageAt,
    int? messageCount,
  }) => ChatSession(
    id: id,
    createdAt: createdAt,
    title: title ?? this.title,
    lastMessageAt: lastMessageAt ?? this.lastMessageAt,
    messageCount: messageCount ?? this.messageCount,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'created_at': createdAt.toIso8601String(),
    'last_message_at': lastMessageAt?.toIso8601String(),
    'message_count': messageCount,
  };
}

/// One message in a chat. `role` is `user`, `assistant`, `tool` or `system`.
class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.role,
    required this.content,
    required this.seq,
    required this.createdAt,
    this.toolCalls,
    this.model,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
    id: json['id'] as String,
    role: json['role'] as String,
    content: json['content'] as String,
    seq: (json['seq'] as num).toInt(),
    createdAt: DateTime.parse(json['created_at'] as String),
    toolCalls: _toolCalls(json['tool_calls']),
    model: json['model'] as String?,
  );

  final String id;
  final String role;
  final String content;
  final int seq;
  final DateTime createdAt;

  /// Tools the harness used to produce this reply (name + JSON args).
  final List<ChatToolCall>? toolCalls;
  final String? model;

  bool get isUser => role == 'user';

  static List<ChatToolCall>? _toolCalls(Object? raw) {
    if (raw == null) return null;
    final list = raw is String
        ? const <dynamic>[]
        : (raw as List<dynamic>? ?? const <dynamic>[]);
    return [
      for (final t in list.cast<Map<String, dynamic>>())
        ChatToolCall(
          name: t['name'] as String? ?? '',
          arguments: t['arguments'] as String? ?? '',
          result: t['result'] as String?,
        ),
    ];
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'role': role,
    'content': content,
    'seq': seq,
    'created_at': createdAt.toIso8601String(),
    'tool_calls': toolCalls?.map((t) => t.toJson()).toList(),
    'model': model,
  };
}

class ChatToolCall {
  const ChatToolCall({
    required this.name,
    required this.arguments,
    this.result,
  });

  final String name;
  final String arguments;
  final String? result;

  Map<String, dynamic> toJson() => {
    'name': name,
    'arguments': arguments,
    if (result != null) 'result': result,
  };
}

/// What `/chat/tools` reports: inference providers and host tools.
class ChatCatalog {
  const ChatCatalog({
    required this.defaultProvider,
    required this.providers,
    required this.tools,
    this.connections = const [],
  });

  factory ChatCatalog.fromJson(Map<String, dynamic> json) => ChatCatalog(
    defaultProvider: json['default_provider'] as String? ?? 'off',
    providers: {
      for (final e in (json['providers'] as Map<String, dynamic>? ?? {}).entries)
        e.key: ChatProviderInfo.fromJson(e.value as Map<String, dynamic>),
    },
    tools: [
      for (final t
          in (json['tools'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
        ChatToolInfo.fromJson(t),
    ],
    connections: [
      for (final c
          in (json['connections'] as List<dynamic>? ?? const [])
              .cast<Map<String, dynamic>>())
        ChatConnection.fromJson(c),
    ],
  );

  final String defaultProvider;
  final Map<String, ChatProviderInfo> providers;
  final List<ChatToolInfo> tools;
  final List<ChatConnection> connections;
}

class ChatProviderInfo {
  const ChatProviderInfo({required this.available, this.model});

  factory ChatProviderInfo.fromJson(Map<String, dynamic> json) =>
      ChatProviderInfo(
        available: json['available'] as bool? ?? false,
        model: json['model'] as String?,
      );

  final bool available;
  final String? model;
}

class ChatToolInfo {
  const ChatToolInfo({
    required this.name,
    required this.description,
    this.available = true,
    this.enabled = true,
  });

  factory ChatToolInfo.fromJson(Map<String, dynamic> json) => ChatToolInfo(
    name: json['name'] as String,
    description: json['description'] as String? ?? '',
    available: json['available'] as bool? ?? true,
    enabled: json['enabled'] as bool? ?? true,
  );

  final String name;
  final String description;
  final bool available;
  final bool enabled;
}

class ChatConnection {
  const ChatConnection({
    required this.id,
    required this.label,
    required this.kind,
    required this.connected,
    this.description,
    this.authorizeUrl,
    this.platforms = const [],
    this.model,
    this.hasSecret = false,
    this.ready = false,
    this.connectedAt,
  });

  factory ChatConnection.fromJson(Map<String, dynamic> json) => ChatConnection(
    id: json['id'] as String,
    label: json['label'] as String? ?? json['id'] as String,
    kind: json['kind'] as String? ?? 'key',
    connected: json['connected'] as bool? ?? false,
    description: json['description'] as String?,
    authorizeUrl: json['authorize_url'] as String?,
    platforms: (json['platforms'] as List<dynamic>? ?? const [])
        .map((e) => e.toString())
        .toList(),
    model: json['model'] as String?,
    hasSecret: json['has_secret'] as bool? ?? false,
    ready: json['ready'] as bool? ?? false,
    connectedAt: json['connected_at'] == null
        ? null
        : DateTime.tryParse(json['connected_at'] as String),
  );

  final String id;
  final String label;
  final String kind;
  final bool connected;
  final String? description;
  final String? authorizeUrl;
  final List<String> platforms;
  final String? model;
  final bool hasSecret;
  final bool ready;
  final DateTime? connectedAt;
}

/// PersonaVoice sidecar as seen through `/voice/status`.
class VoiceStatus {
  const VoiceStatus({
    required this.available,
    this.url,
    this.live = false,
    this.provider,
    this.model,
  });

  factory VoiceStatus.fromJson(Map<String, dynamic> json) {
    final brain = json['brain'] is Map
        ? Map<String, dynamic>.from(json['brain'] as Map)
        : const <String, dynamic>{};
    return VoiceStatus(
      available: json['available'] as bool? ?? false,
      url: json['url'] as String?,
      live: json['session'] is Map,
      provider: brain['provider'] as String?,
      model: brain['model'] as String?,
    );
  }

  static const unavailable = VoiceStatus(available: false);

  final bool available;
  final String? url;
  final bool live;
  final String? provider;
  final String? model;
}

/// Streamed increments while a reply is being produced.
sealed class ChatStreamEvent {
  const ChatStreamEvent();
}

/// The stored user message (echoed first).
final class ChatUserStored extends ChatStreamEvent {
  const ChatUserStored(this.message);
  final ChatMessage message;
}

/// A piece of assistant text.
final class ChatDelta extends ChatStreamEvent {
  const ChatDelta(this.text);
  final String text;
}

/// The harness called a tool.
final class ChatToolUsed extends ChatStreamEvent {
  const ChatToolUsed(this.call);
  final ChatToolCall call;
}

/// The full stored assistant message.
final class ChatDone extends ChatStreamEvent {
  const ChatDone(this.message);
  final ChatMessage message;
}

/// The turn failed server-side; the user message is still stored.
final class ChatFailed extends ChatStreamEvent {
  const ChatFailed(this.message);
  final String message;
}
