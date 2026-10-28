import 'package:scoria_api/scoria_api.dart';
import 'package:test/test.dart';

void main() {
  const memory = '''
Ben is building Scoria, which contains the chat harness.
A goal is to ship the chat harness.
His habit is a flat white every morning.
''';

  group('Conclusion.parse', () {
    test('keeps names the memory actually says and drops the rest', () {
      const raw = '''
{"things":[
  {"type":"project","name":"Scoria","outcome":"a local memory system"},
  {"type":"goal","name":"ship the chat harness","why":"the phone client"},
  {"type":"habit","name":"flat white","cadence":"every morning","parent":"Scoria"},
  {"type":"entity","name":"Ben","kind":"person"},
  {"type":"entity","name":"Paris","kind":"place"}
],
 "edges":[
  {"source":"Scoria","target":"ship the chat harness","kind":"pursues"},
  {"source":"flat white","target":"ship the chat harness","kind":"supports"},
  {"source":"Ben","target":"Scoria","kind":"part_of"}
]}
''';
      final conclusion = Conclusion.parse(raw, memory);
      expect(conclusion.things.map((t) => t.name), [
        'Scoria',
        'ship the chat harness',
        'flat white',
        'Ben',
        'chat harness',
      ]);
      expect(
        conclusion.edges.map((e) => '${e.source}|${e.kind}|${e.target}'),
        containsAll([
          'chat harness|part_of|Scoria',
          'Scoria|pursues|ship the chat harness',
        ]),
      );
      expect(
        conclusion.edges.any((e) => e.kind == 'part_of' && e.source == 'Ben'),
        isFalse,
      );
      expect(
        conclusion.edges.any(
          (e) => e.kind == 'part_of' && e.source == 'flat white',
        ),
        isFalse,
      );
      expect(
        conclusion.edges.any((e) => e.source == 'Paris' || e.target == 'Paris'),
        isFalse,
      );
    });

    test('rejects a JSON-less reply', () {
      expect(
        () => Conclusion.parse('no graph here', memory),
        throwsFormatException,
      );
    });
  });

  group('EvidenceFold', () {
    test(
      'a note verifies immediately and a second memory verifies a guess',
      () {
        final once = EvidenceFold.fold(
          existingStatus: null,
          existingEvidence: null,
          memoryId: 'm1',
          explicit: false,
        );
        expect(once.status, 'proposed');
        final noted = EvidenceFold.fold(
          existingStatus: null,
          existingEvidence: null,
          memoryId: 'm1',
          explicit: true,
        );
        expect(noted.status, 'verified');
        final twice = EvidenceFold.fold(
          existingStatus: once.status,
          existingEvidence: once.evidence,
          memoryId: 'm2',
          explicit: false,
        );
        expect(twice.status, 'verified');
        expect(twice.evidence, 'm1,m2');
        final again = EvidenceFold.fold(
          existingStatus: twice.status,
          existingEvidence: twice.evidence,
          memoryId: 'm2',
          explicit: false,
        );
        expect(again.changed, isFalse);
        final rejected = EvidenceFold.fold(
          existingStatus: 'rejected',
          existingEvidence: 'm1',
          memoryId: 'm3',
          explicit: true,
        );
        expect(rejected.changed, isFalse);
        expect(rejected.status, 'rejected');
      },
    );
  });

  group('lifeGraphBlock', () {
    test('states containment and hides proposed edges', () {
      final block = lifeGraphBlock({
        'projects': [
          {
            'name': 'Scoria',
            'status': 'active',
            'outcome': 'local memory',
            'parent': null,
            'parts': [
              {'name': 'chat harness'},
            ],
          },
        ],
        'goals': [
          {
            'name': 'ship the chat harness',
            'status': 'active',
            'why': 'the phone client',
            'parent': {'name': 'Scoria'},
            'parts': <Map<String, dynamic>>[],
          },
        ],
        'habits': <Map<String, dynamic>>[],
        'entities': <Map<String, dynamic>>[],
        'edges': [
          {
            'status': 'verified',
            'kind': 'pursues',
            'source': {'name': 'Scoria'},
            'target': {'name': 'ship the chat harness'},
          },
          {
            'status': 'proposed',
            'kind': 'supports',
            'source': {'name': 'flat white'},
            'target': {'name': 'Scoria'},
          },
        ],
      });
      expect(block, contains('Scoria (active) — local memory'));
      expect(block, contains('contains chat harness'));
      expect(block, contains('inside Scoria'));
      expect(block, contains('Scoria pursues ship the chat harness'));
      expect(block, contains('1 proposed relationships'));
      expect(block, isNot(contains('flat white supports')));
    });
  });
}
