part of 'memory_bloc.dart';

enum MemoryStatus { initial, loading, success, failure }

final class MemoryState extends Equatable {
  const new({
    this.status = MemoryStatus.initial,
    this.items = const [],
    this.hasMore = true,
    this.error,
  });

  final MemoryStatus status;
  final List<MemoryItem> items;
  final bool hasMore;
  final String? error;

  MemoryState copyWith({
    MemoryStatus? status,
    List<MemoryItem>? items,
    bool? hasMore,
    String? error,
    bool clearError = false,
  }) {
    return MemoryState(
      status: status ?? this.status,
      items: items ?? this.items,
      hasMore: hasMore ?? this.hasMore,
      error: clearError ? null : (error ?? this.error),
    );
  }

  @override
  List<Object?> get props => [status, items, hasMore, error];
}
