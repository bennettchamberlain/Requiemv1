part of 'jobs_bloc.dart';

sealed class JobsEvent extends Equatable {
  const new();

  @override
  List<Object?> get props => [];
}

final class JobsFetched extends JobsEvent {
  const new();
}

final class JobsRefreshed extends JobsEvent {
  const new();
}

/// Empty set means "all states".
final class JobsFilterChanged extends JobsEvent {
  const new(this.states);

  final Set<JobState> states;

  @override
  List<Object?> get props => [states];
}
