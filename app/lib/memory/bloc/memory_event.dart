part of 'memory_bloc.dart';

sealed class MemoryEvent extends Equatable {
  const new();

  @override
  List<Object?> get props => [];
}

/// First load. No-op once the feed is already loaded.
final class MemoryFetched extends MemoryEvent {
  const new();
}

/// Pull-to-refresh: reload the first page.
final class MemoryRefreshed extends MemoryEvent {
  const new();
}

/// Scrolled to the end: fetch the next page.
final class MemoryLoadedMore extends MemoryEvent {
  const new();
}

/// A manual note typed in the app.
final class MemoryNoteAdded extends MemoryEvent {
  const new({
    required this.title,
    required this.sourceId,
    this.body,
    this.occurredAt,
  });

  final String title;
  final String? body;
  final DateTime? occurredAt;

  /// Idempotency key; the server upserts on (owner, source, source_id).
  final String sourceId;

  @override
  List<Object?> get props => [title, body, occurredAt, sourceId];
}
