import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_models/scoria_models.dart';

part 'memory_event.dart';
part 'memory_state.dart';

/// The memory feed: newest first, paged by `occurred_at` cursor, plus
/// manual note creation. Every call goes through the api client as the
/// signed-in person; Napalm decides what comes back.
class MemoryBloc extends Bloc<MemoryEvent, MemoryState> {
  new({required this._api, this.pageSize = 50}) : super(const MemoryState()) {
    on<MemoryFetched>(_onFetched);
    on<MemoryRefreshed>(_onRefreshed);
    on<MemoryLoadedMore>(_onLoadedMore);
    on<MemoryNoteAdded>(_onNoteAdded);
  }

  final ScoriaApiClient _api;
  final int pageSize;

  Future<void> _onFetched(MemoryFetched e, Emitter<MemoryState> emit) async {
    if (state.status == MemoryStatus.success) return;
    emit(state.copyWith(status: MemoryStatus.loading));
    await _load(emit, replace: true);
  }

  Future<void> _onRefreshed(
    MemoryRefreshed e,
    Emitter<MemoryState> emit,
  ) async {
    await _load(emit, replace: true);
  }

  Future<void> _onLoadedMore(
    MemoryLoadedMore e,
    Emitter<MemoryState> emit,
  ) async {
    if (!state.hasMore || state.status != MemoryStatus.success) return;
    await _load(emit, replace: false);
  }

  Future<void> _onNoteAdded(
    MemoryNoteAdded e,
    Emitter<MemoryState> emit,
  ) async {
    try {
      final item = await _api.memoryUpsert(
        MemoryUpsert(
          kind: 'note',
          title: e.title,
          body: e.body,
          occurredAt: e.occurredAt ?? DateTime.now().toUtc(),
          source: 'manual',
          sourceId: e.sourceId,
        ),
      );
      final items = [item, ...state.items.where((m) => m.id != item.id)]
        ..sort((a, b) => b.occurredAt.compareTo(a.occurredAt));
      emit(state.copyWith(items: items, status: MemoryStatus.success));
    } on ScoriaApiException catch (err) {
      emit(state.copyWith(error: err.message));
    }
  }

  Future<void> _load(Emitter<MemoryState> emit, {required bool replace}) async {
    try {
      final before = replace ? null : state.items.lastOrNull?.occurredAt;
      final page = await _api.memoryFeed(before: before, limit: pageSize);
      emit(
        state.copyWith(
          status: MemoryStatus.success,
          items: replace ? page : [...state.items, ...page],
          hasMore: page.length >= pageSize,
          clearError: true,
        ),
      );
    } on ScoriaApiException catch (err) {
      emit(state.copyWith(status: MemoryStatus.failure, error: err.message));
    } on Exception catch (err) {
      emit(state.copyWith(status: MemoryStatus.failure, error: '$err'));
    }
  }
}
