import 'dart:async';

import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_models/scoria_models.dart';

part 'chat_event.dart';
part 'chat_state.dart';

/// Chats with the agent harness. Holds the session list and the open
/// session's messages; a send streams the reply token by token into
/// `draftReply` until the server confirms the stored assistant message.
class ChatBloc extends Bloc<ChatEvent, ChatState> {
  new({required this._api}) : super(const ChatState()) {
    on<ChatStarted>(_onStarted);
    on<ChatSessionOpened>(_onOpened);
    on<ChatNewSessionRequested>(_onNew);
    on<ChatSessionDeleted>(_onDeleted);
    on<ChatMessageSent>(_onSent, transformer: _sequential());
    on<ChatBackToList>((e, emit) => emit(state.copyWith(clearOpen: true)));
  }

  final ScoriaApiClient _api;

  static EventTransformer<T> _sequential<T>() =>
      (events, mapper) => events.asyncExpand(mapper);

  Future<void> _onStarted(ChatStarted e, Emitter<ChatState> emit) async {
    emit(state.copyWith(status: ChatStatus.loading, clearError: true));
    try {
      final sessions = await _api.chatSessions();
      emit(state.copyWith(status: ChatStatus.ready, sessions: sessions));
    } on Exception catch (err) {
      emit(state.copyWith(status: ChatStatus.failure, error: _msg(err)));
    }
  }

  Future<void> _onOpened(ChatSessionOpened e, Emitter<ChatState> emit) async {
    emit(
      state.copyWith(
        open: e.session,
        messages: const [],
        status: ChatStatus.loading,
        clearError: true,
      ),
    );
    try {
      final messages = await _api.chatMessages(e.session.id);
      emit(state.copyWith(status: ChatStatus.ready, messages: messages));
    } on Exception catch (err) {
      emit(state.copyWith(status: ChatStatus.failure, error: _msg(err)));
    }
  }

  Future<void> _onNew(
    ChatNewSessionRequested e,
    Emitter<ChatState> emit,
  ) async {
    try {
      final session = await _api.chatCreate();
      emit(
        state.copyWith(
          sessions: [session, ...state.sessions],
          open: session,
          messages: const [],
          status: ChatStatus.ready,
          clearError: true,
        ),
      );
    } on Exception catch (err) {
      emit(state.copyWith(error: _msg(err)));
    }
  }

  Future<void> _onDeleted(ChatSessionDeleted e, Emitter<ChatState> emit) async {
    try {
      await _api.chatDelete(e.session.id);
      emit(
        state.copyWith(
          sessions: state.sessions.where((s) => s.id != e.session.id).toList(),
          clearOpen: state.open?.id == e.session.id,
        ),
      );
    } on Exception catch (err) {
      emit(state.copyWith(error: _msg(err)));
    }
  }

  Future<void> _onSent(ChatMessageSent e, Emitter<ChatState> emit) async {
    var open = state.open;
    final text = e.content.trim();
    if (text.isEmpty) return;
    try {
      if (open == null) {
        open = await _api.chatCreate();
        emit(
          state.copyWith(
            sessions: [open, ...state.sessions],
            open: open,
            messages: const [],
          ),
        );
      }
      emit(
        state.copyWith(
          sending: true,
          draftReply: '',
          draftTools: const [],
          clearError: true,
        ),
      );
      await for (final ev in _api.chatSend(open.id, text)) {
        switch (ev) {
          case ChatUserStored(:final message):
            emit(state.copyWith(messages: [...state.messages, message]));
          case ChatDelta(:final text):
            emit(state.copyWith(draftReply: '${state.draftReply}$text'));
          case ChatToolUsed(:final call):
            emit(state.copyWith(draftTools: [...state.draftTools, call]));
          case ChatDone(:final message):
            final title =
                open.title ?? _titleFrom(state.messages.first.content);
            final updated = open.copyWith(
              title: title,
              lastMessageAt: message.createdAt,
              messageCount: state.messages.length + 1,
            );
            emit(
              state.copyWith(
                messages: [...state.messages, message],
                sending: false,
                draftReply: '',
                draftTools: const [],
                open: updated,
                sessions: [
                  updated,
                  ...state.sessions.where((s) => s.id != updated.id),
                ],
              ),
            );
          case ChatFailed(:final message):
            emit(
              state.copyWith(
                sending: false,
                draftReply: '',
                draftTools: const [],
                error: message,
              ),
            );
        }
      }
    } on Exception catch (err) {
      emit(state.copyWith(sending: false, draftReply: '', error: _msg(err)));
    }
    if (state.sending) {
      // Stream ended without a terminal event (connection dropped).
      emit(state.copyWith(sending: false, error: 'connection lost'));
    }
  }

  static String _titleFrom(String content) {
    final oneLine = content.replaceAll(RegExp(r'\s+'), ' ').trim();
    return oneLine.length <= 60 ? oneLine : '${oneLine.substring(0, 57)}…';
  }

  static String _msg(Exception e) => switch (e) {
    ScoriaApiException(:final statusCode, :final message) =>
      statusCode == 503
          ? 'The agent is not running on the server (SCORIA_AGENT_URL).'
          : message,
    _ => '$e',
  };
}
