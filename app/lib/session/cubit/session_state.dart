part of 'session_cubit.dart';

enum SessionStatus { unauthenticated, authenticated }

final class SessionState extends Equatable {
  const new _({required this.status, this.session});

  const new unauthenticated() : this._(status: SessionStatus.unauthenticated);

  const new authenticated(Session session)
    : this._(status: SessionStatus.authenticated, session: session);

  final SessionStatus status;
  final Session? session;

  Person? get person => session?.person;

  @override
  List<Object?> get props => [status, session?.token];
}
