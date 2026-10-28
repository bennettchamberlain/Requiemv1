part of 'chat_bloc.dart';

sealed class ChatEvent extends Equatable {
  const new();

  @override
  List<Object?> get props => const [];
}

/// Load the session list.
final class ChatStarted extends ChatEvent {
  const new();
}

final class ChatSessionOpened extends ChatEvent {
  const new(this.session);
  final ChatSession session;

  @override
  List<Object?> get props => [session.id];
}

final class ChatNewSessionRequested extends ChatEvent {
  const new();
}

final class ChatSessionDeleted extends ChatEvent {
  const new(this.session);
  final ChatSession session;

  @override
  List<Object?> get props => [session.id];
}

/// Send a turn in the open session (a session is created if none is open).
final class ChatMessageSent extends ChatEvent {
  const new(this.content);
  final String content;

  @override
  List<Object?> get props => [content];
}

/// Phone layout: leave the open session and show the list.
final class ChatBackToList extends ChatEvent {
  const new();
}
