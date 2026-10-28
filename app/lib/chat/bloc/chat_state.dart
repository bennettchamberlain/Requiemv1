part of 'chat_bloc.dart';

enum ChatStatus { initial, loading, ready, failure }

final class ChatState extends Equatable {
  const new({
    this.status = ChatStatus.initial,
    this.sessions = const [],
    this.open,
    this.messages = const [],
    this.sending = false,
    this.draftReply = '',
    this.draftTools = const [],
    this.error,
  });

  final ChatStatus status;
  final List<ChatSession> sessions;

  /// The session on screen; null shows the list.
  final ChatSession? open;
  final List<ChatMessage> messages;

  /// A reply is streaming in.
  final bool sending;

  /// Assistant text received so far for the in-flight turn.
  final String draftReply;

  /// Tools the harness has called during the in-flight turn.
  final List<ChatToolCall> draftTools;
  final String? error;

  ChatState copyWith({
    ChatStatus? status,
    List<ChatSession>? sessions,
    ChatSession? open,
    bool clearOpen = false,
    List<ChatMessage>? messages,
    bool? sending,
    String? draftReply,
    List<ChatToolCall>? draftTools,
    String? error,
    bool clearError = false,
  }) {
    return ChatState(
      status: status ?? this.status,
      sessions: sessions ?? this.sessions,
      open: clearOpen ? null : (open ?? this.open),
      messages: clearOpen ? const [] : (messages ?? this.messages),
      sending: sending ?? this.sending,
      draftReply: draftReply ?? this.draftReply,
      draftTools: draftTools ?? this.draftTools,
      error: clearError ? null : (error ?? this.error),
    );
  }

  @override
  List<Object?> get props => [
    status,
    sessions.map((s) => '${s.id}:${s.title}:${s.messageCount}').toList(),
    open?.id,
    messages.map((m) => m.id).toList(),
    sending,
    draftReply,
    draftTools.length,
    error,
  ];
}
