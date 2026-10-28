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
  const ChatToolCall({required this.name, required this.arguments});

  final String name;
  final String arguments;

  Map<String, dynamic> toJson() => {'name': name, 'arguments': arguments};
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
