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
}
