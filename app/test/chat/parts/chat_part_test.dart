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

    test('a speech fence is a spoken line', () {
      const content = '''
Here is the plan.

```scoria
{"type":"speech","text":"Dinner is at seven."}
```
''';
      final segments = parseChatSegments(content);
      expect(segments.first, isA<ChatProse>());
      expect(
        (segments.last as ChatBlock).part,
        const ChatSpeech('Dinner is at seven.'),
      );
      expect(spokenLinesOf(content), ['Dinner is at seven.']);
    });

    test('prose is spoken when there is no speech part', () {
      expect(
        spokenLinesOf('Hello there. More after that. Ignored third.'),
        ['Hello there. More after that.'],
      );
    });

    test('memory, place, graph and actions parse from the catalog', () {
      const content = '''
```scoria
{"type":"timeline","title":"Memory","children":[{"type":"memory","id":"m1","title":"Standup","kind":"event","when":"2026-10-28","body":"Alex","place":{"type":"place","name":"Cafe","city":"Oakland"}}]}
```

```scoria
{"type":"graph","goals":[{"name":"ship chat","why":"the phone"}],"edges":[{"kind":"knows","status":"verified","source":{"name":"Alex"},"target":{"name":"standup"}}]}
```

```scoria
{"type":"actions","items":[{"label":"Search more","prompt":"search memory for Alex"}]}
```
''';
      final segments = parseChatSegments(content);
      expect(segments, hasLength(3));
      final timeline = (segments[0] as ChatBlock).part as ChatTimeline;
      final memory = timeline.children.single as ChatMemory;
      expect(memory.title, 'Standup');
      expect(memory.place?.city, 'Oakland');
      final graph = (segments[1] as ChatBlock).part as ChatGraph;
      expect(graph.nodes.single.name, 'ship chat');
      expect(graph.edges.single.source, 'Alex');
      expect(
        (segments[2] as ChatBlock).part,
        const ChatActions([
          ChatAction(label: 'Search more', prompt: 'search memory for Alex'),
        ]),
      );
    });

    test('a memory_search tool result becomes a timeline', () {
      final segments = parseChatSegments(
        '',
        tools: [
          ChatToolCall(
            name: 'memory_search',
            arguments: '{"query":"Alex"}',
            result:
                '{"type":"timeline","title":"Memory","children":[{"type":"memory","title":"Standup","kind":"event"}]}',
          ),
        ],
      );
      final timeline = (segments.single as ChatBlock).part as ChatTimeline;
      expect(timeline.title, 'Memory');
      expect((timeline.children.single as ChatMemory).title, 'Standup');
    });
  });

  test('screenNoteOf lists the parts a reply drew', () {
    const content = '''
Here is the week.

```scoria
{"type":"timeline","title":"Memory","children":[{"type":"memory","title":"Standup","kind":"event"}]}
```

```scoria
{"type":"graph","entities":[{"name":"Ada","kind":"person"}],"edges":[{"source":"Ada","target":"Standup","kind":"knows","status":"verified"}]}
```
''';
    expect(
      screenNoteOf(content),
      'timeline: Memory\n'
      'memory: Standup (event)\n'
      'person: Ada\n'
      'edge: Ada knows Standup (verified)',
    );
    final at = DateTime.utc(2026, 10, 28);
    expect(
      screenNoteOfMessages([
        ChatMessage(
          id: '1',
          role: 'user',
          content: 'what is on',
          seq: 1,
          createdAt: at,
        ),
        ChatMessage(
          id: '2',
          role: 'assistant',
          content: content,
          seq: 2,
          createdAt: at,
        ),
      ]),
      screenNoteOf(content),
    );
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
