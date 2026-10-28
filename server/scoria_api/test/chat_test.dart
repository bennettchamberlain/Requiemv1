import 'dart:io';

import 'package:scoria_api/scoria_api.dart';
import 'package:test/test.dart';

void main() {
  group('AgentClient URIs', () {
    test('Parasail /v1 base does not double the version', () {
      final base = Uri.parse('https://api.parasail.io/v1');
      expect(
        AgentClient.completionsUri(base).toString(),
        'https://api.parasail.io/v1/chat/completions',
      );
      expect(
        AgentClient.modelsUri(base).toString(),
        'https://api.parasail.io/v1/models',
      );
    });

    test('Ollama host gets /v1 prefixed', () {
      final base = Uri.parse('http://127.0.0.1:11434');
      expect(
        AgentClient.completionsUri(base).toString(),
        'http://127.0.0.1:11434/v1/chat/completions',
      );
    });
  });

  group('ChatToolbox formatting', () {
    test('memories and graph collapse to readable lines', () {
      expect(
        ChatToolbox.formatMemories(const []),
        'no memories',
      );
      expect(
        ChatToolbox.formatMemoryRow({
          'id': 'abc',
          'title': 'Friday standup',
          'body': 'Alex and the team',
          'occurred_at': '2026-10-28',
        }),
        contains('Friday standup'),
      );
      expect(
        ChatToolbox.formatGraph({
          'goals': [
            {'name': 'ship chat', 'why': 'the phone'},
          ],
          'edges': [
            {
              'kind': 'knows',
              'status': 'verified',
              'source': {'name': 'Alex'},
              'target': {'name': 'standup'},
            },
          ],
        }),
        allOf(contains('ship chat'), contains('Alex knows standup')),
      );
    });
  });

  group('ToolPrefsStore', () {
    test('round-trips a You.com key and disabled tools', () async {
      final dir = await Directory.systemTemp.createTemp('requiem-secrets');
      addTearDown(() => dir.delete(recursive: true));
      final store = ToolPrefsStore(dir);
      await store.write(
        'person-1',
        const ToolPrefs(youKey: 'secret-you', disabled: {'web_search'}),
      );
      final got = await store.read('person-1');
      expect(got.youKey, 'secret-you');
      expect(got.enabled('web_search'), isFalse);
      expect(got.enabled('now'), isTrue);
      await store.write('person-1', got.copyWith(clearYouKey: true));
      expect((await store.read('person-1')).youKey, isNull);
    });
  });

  group('Config chat provider', () {
    test('reads Parasail chat model and You.com key', () {
      final c = Config.fromEnv({
        'SCORIA_SESSION_SECRET': 'a-very-long-secret-at-least-32-chars!!',
        'PARASAIL_API_KEY': 'k',
        'PARASAIL_MODEL': 'parasail-glm-53-flash',
        'YDC_API_KEY': 'you',
        'OLLAMA_URL': 'http://127.0.0.1:11434',
        'SCORIA_CHAT_PROVIDER': 'auto',
      });
      expect(c.parasailChatModel, 'parasail-glm-53-flash');
      expect(c.youApiKey, 'you');
      expect(c.chatProvider, 'auto');
      expect(c.ollamaChatModel, 'llama3.2');
    });
  });
}
