import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/memory/memory.dart';
import 'package:scoria_models/scoria_models.dart';

class _MockApi extends Mock implements ScoriaApiClient;

MemoryItem _item(String id, DateTime at) => MemoryItem(
  id: id,
  kind: 'note',
  title: id,
  occurredAt: at,
  source: 'manual',
);

void main() {
  late _MockApi api;
  final t0 = DateTime.utc(2026, 10, 27, 12);

  setUpAll(() {
    registerFallbackValue(
      MemoryUpsert(
        kind: 'note',
        occurredAt: t0,
        source: 'manual',
        sourceId: 'x',
      ),
    );
  });

  setUp(() => api = _MockApi());

  group('MemoryBloc', () {
    blocTest<MemoryBloc, MemoryState>(
      'loads first page and reports hasMore from page size',
      setUp: () {
        when(() => api.memoryFeed(limit: 2)).thenAnswer(
          (_) async => [
            _item('a', t0),
            _item('b', t0.subtract(const Duration(hours: 1))),
          ],
        );
      },
      build: () => MemoryBloc(api: api, pageSize: 2),
      act: (b) => b.add(const MemoryFetched()),
      expect: () => [
        const MemoryState(status: MemoryStatus.loading),
        isA<MemoryState>()
            .having((s) => s.status, 'status', MemoryStatus.success)
            .having((s) => s.items.length, 'items', 2)
            .having((s) => s.hasMore, 'hasMore', true),
      ],
    );

    blocTest<MemoryBloc, MemoryState>(
      'loads more using the last occurred_at as cursor',
      setUp: () {
        when(() => api.memoryFeed(before: t0, limit: 2)).thenAnswer(
          (_) async => [_item('c', t0.subtract(const Duration(days: 1)))],
        );
      },
      build: () => MemoryBloc(api: api, pageSize: 2),
      seed: () => MemoryState(
        status: MemoryStatus.success,
        items: [_item('a', t0.add(const Duration(hours: 1))), _item('b', t0)],
      ),
      act: (b) => b.add(const MemoryLoadedMore()),
      expect: () => [
        isA<MemoryState>()
            .having((s) => s.items.map((m) => m.id).toList(), 'ids', [
              'a',
              'b',
              'c',
            ])
            .having((s) => s.hasMore, 'hasMore', false),
      ],
    );

    blocTest<MemoryBloc, MemoryState>(
      'surfaces api failure',
      setUp: () {
        when(() => api.memoryFeed())
            .thenThrow(const ScoriaApiException(401, 'expired'));
      },
      build: () => MemoryBloc(api: api),
      act: (b) => b.add(const MemoryFetched()),
      expect: () => [
        const MemoryState(status: MemoryStatus.loading),
        const MemoryState(status: MemoryStatus.failure, error: 'expired'),
      ],
    );

    blocTest<MemoryBloc, MemoryState>(
      'adds a note at the top, de-duplicating by id',
      setUp: () {
        when(() => api.memoryUpsert(any())).thenAnswer(
          (_) async => _item('new', t0.add(const Duration(hours: 2))),
        );
      },
      build: () => MemoryBloc(api: api),
      seed: () =>
          MemoryState(status: MemoryStatus.success, items: [_item('a', t0)]),
      act: (b) => b.add(const MemoryNoteAdded(title: 'hi', sourceId: 'k1')),
      expect: () => [
        isA<MemoryState>().having(
          (s) => s.items.map((m) => m.id).toList(),
          'ids',
          ['new', 'a'],
        ),
      ],
      verify: (_) {
        final sent =
            verify(() => api.memoryUpsert(captureAny())).captured.single
                as MemoryUpsert;
        expect(sent.sourceId, 'k1');
        expect(sent.source, 'manual');
      },
    );
  });
}
