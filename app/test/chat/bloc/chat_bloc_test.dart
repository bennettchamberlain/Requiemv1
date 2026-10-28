import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/chat/chat.dart';
import 'package:scoria_models/scoria_models.dart';

class _MockApi extends Mock implements ScoriaApiClient;

void main() {
  final session = ChatSession(id: 's1', createdAt: DateTime.utc(2026));
  ChatMessage msg(String id, String role, String text, int seq) => ChatMessage(
    id: id,
    role: role,
    content: text,
    seq: seq,
    createdAt: DateTime.utc(2026),
  );

  group('ChatBloc', () {
    late _MockApi api;

    setUp(() => api = _MockApi());

    blocTest<ChatBloc, ChatState>(
      'loads sessions on start',
      build: () {
        when(api.chatSessions).thenAnswer((_) async => [session]);
        return ChatBloc(api: api);
      },
      act: (b) => b.add(const ChatStarted()),
      expect: () => [
        const ChatState(status: ChatStatus.loading),
        ChatState(status: ChatStatus.ready, sessions: [session]),
      ],
    );

    blocTest<ChatBloc, ChatState>(
      'send streams a reply into draftReply, then stores the message',
      build: () {
        when(() => api.chatSend('s1', 'hi')).thenAnswer(
          (_) => Stream.fromIterable([
            ChatUserStored(msg('u1', 'user', 'hi', 1)),
            const ChatDelta('Hel'),
            const ChatDelta('lo'),
            ChatDone(msg('a1', 'assistant', 'Hello', 2)),
          ]),
        );
        return ChatBloc(api: api);
      },
      seed: () => ChatState(
        status: ChatStatus.ready,
        sessions: [session],
        open: session,
      ),
      act: (b) => b.add(const ChatMessageSent('hi')),
      verify: (b) {
        expect(b.state.sending, isFalse);
        expect(b.state.draftReply, isEmpty);
        expect(b.state.messages.map((m) => m.content), ['hi', 'Hello']);
        expect(b.state.open?.title, 'hi');
        expect(b.state.sessions.single.messageCount, 2);
      },
    );

    blocTest<ChatBloc, ChatState>(
      'a server-side failure surfaces as error and stops sending',
      build: () {
        when(() => api.chatSend('s1', 'hi')).thenAnswer(
          (_) => Stream.fromIterable([
            ChatUserStored(msg('u1', 'user', 'hi', 1)),
            const ChatFailed('agent 503'),
          ]),
        );
        return ChatBloc(api: api);
      },
      seed: () => ChatState(status: ChatStatus.ready, open: session),
      act: (b) => b.add(const ChatMessageSent('hi')),
      verify: (b) {
        expect(b.state.sending, isFalse);
        expect(b.state.error, 'agent 503');
        expect(b.state.messages.length, 1);
      },
    );
  });
}
