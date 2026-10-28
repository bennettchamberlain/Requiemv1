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
}
