import 'package:flutter_test/flutter_test.dart';
import 'package:scoria_app/chat/parts/chat_part.dart';
import 'package:scoria_app/chat/parts/chat_part_view.dart';
import 'package:scoria_app/chat/parts/you_search.dart';
import 'package:scoria_models/scoria_models.dart';

import '../../helpers/pump_app.dart';

void main() {
  group('parseChatSegments', () {
    test('reads a nested card inside a column', () {
      const content = '''
Look at this.

```scoria
{"type":"column","children":[{"type":"card","title":"Place","subtitle":"cafe","detail":{"type":"text","text":"Open late"}}]}
```
''';
      final segments = parseChatSegments(content);
      expect(segments, hasLength(2));
      expect(segments.first, isA<ChatProse>());
      final block = segments.last as ChatBlock;
      final column = block.part as ChatColumn;
      final card = column.children.single as ChatCard;
      expect(card.title, 'Place');
      expect(card.subtitle, 'cafe');
      expect(card.detail, const ChatText('Open late'));
    });

    test('turns a web_search tool into a live search', () {
      final segments = parseChatSegments(
        '',
        tools: const [
          ChatToolCall(
            name: 'web_search',
            arguments: '{"query":"dart maps"}',
          ),
        ],
      );
      expect(segments, [const ChatBlock(ChatWebSearch('dart maps'))]);
    });

    test('turns a stored search result into nested cards', () {
      final segments = parseChatSegments(
        '',
        tools: const [
          ChatToolCall(
            name: 'web_search',
            arguments: '{"query":"dart maps"}',
            result: 'Dart maps: language docs\nFlutter maps: widget catalog',
          ),
        ],
      );
      final column = (segments.single as ChatBlock).part as ChatColumn;
      expect(column.children.first, const ChatHeading('dart maps'));
      expect(
        column.children[1],
        isA<ChatCard>()
            .having((card) => card.title, 'title', 'Dart maps')
            .having((card) => card.subtitle, 'subtitle', 'language docs'),
      );
    });

    test('a search fence parses back to the same query', () {
      final segments = parseChatSegments(scoriaWebSearchFence('dart maps'));
      expect(segments, [const ChatBlock(ChatWebSearch('dart maps'))]);
    });

    test('an open fence is a pending block', () {
      final segments = parseChatSegments('```scoria\n{"type":"text"');
      expect(segments, [const ChatBlockPending()]);
    });
  });

  test('YouHit.listFromResponse reads web hits', () {
    final hits = YouHit.listFromResponse({
      'results': {
        'web': [
          {
            'title': 'Dart',
            'url': 'https://dart.dev',
            'description': 'Language',
            'snippets': ['A snippet'],
            'page_age': '2 days ago',
          },
        ],
      },
    });
    expect(hits, hasLength(1));
    expect(hits.single.title, 'Dart');
    expect(hits.single.url, 'https://dart.dev');
    expect(hits.single.snippets, ['A snippet']);
    expect(hits.single.pageAge, '2 days ago');
  });

  testWidgets('a card expands its detail in place', (tester) async {
    await tester.pumpApp(
      const ChatPartView(
        ChatCard(
          title: 'Place',
          detail: ChatText('Open late'),
        ),
      ),
    );
    expect(find.text('Place'), findsOneWidget);
    expect(find.text('Open late'), findsNothing);
    await tester.tap(find.text('More'));
    await tester.pump();
    expect(find.text('Open late'), findsOneWidget);
    await tester.tap(find.text('Less'));
    await tester.pump();
    expect(find.text('Open late'), findsNothing);
  });
}
