import 'package:scoria_models/scoria_models.dart';
import 'package:test/test.dart';

void main() {
  test('MemoryItem round-trips', () {
    final json = {
      'id': 'a',
      'kind': 'note',
      'title': 't',
      'occurred_at': '2026-10-19T12:00:00Z',
      'source': 'flutter',
      'owner': {'id': 'p', 'handle': 'sam'},
    };
    final item = MemoryItem.fromJson(json);
    expect(item.owner?.handle, 'sam');
    expect(MemoryItem.fromJson(item.toJson()).id, 'a');
  });

  test('JobState parses unknown as created', () {
    expect(JobState.parse('weird'), JobState.created);
  });

  test('OneGrant and GraphEdge round-trip', () {
    final grant = OneGrant.fromJson({
      'id': 'g',
      'one_user_id': 'u1',
      'platforms': ['gmail'],
    });
    expect(grant.platforms, ['gmail']);
    final edge = GraphEdge.fromJson({
      'id': 'e',
      'kind': 'knows',
      'status': 'proposed',
      'source': {'id': 'a', 'name': 'Alex'},
      'target': {'id': 'b', 'name': 'Scoria'},
    });
    expect(edge.source?.name, 'Alex');
    expect(GraphEdge.fromJson(edge.toJson()).kind, 'knows');
  });

  test('ChatCatalog and tool calls include results', () {
    final catalog = ChatCatalog.fromJson({
      'default_provider': 'parasail',
      'providers': {
        'parasail': {'available': true, 'model': 'parasail-glm-53-flash'},
      },
      'tools': [
        {
          'name': 'memory_search',
          'description': 'Search memory',
          'available': true,
        },
      ],
    });
    expect(catalog.defaultProvider, 'parasail');
    expect(catalog.tools.single.name, 'memory_search');
    final call = ChatToolCall(
      name: 'now',
      arguments: '{}',
      result: '2026-10-28',
    );
    expect(call.toJson()['result'], '2026-10-28');
  });

  test('VoiceStatus reads a live sidecar', () {
    final status = VoiceStatus.fromJson({
      'available': true,
      'url': 'http://127.0.0.1:8998',
      'starting': true,
      'keep_until': '2026-10-29T04:00:00-0700',
      'keep_seconds': 21600,
      'brain': {'provider': 'parasail', 'model': 'parasail-glm-53-flash'},
      'engine': {'loaded': false, 'loading': true},
      'session': {'turns': 1},
    });
    expect(status.available, isTrue);
    expect(status.live, isTrue);
    expect(status.loading, isTrue);
    expect(status.keepSeconds, 21600);
    expect(status.provider, 'parasail');
    expect(status.model, 'parasail-glm-53-flash');
  });
}
