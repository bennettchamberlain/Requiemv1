import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:scoria_models/scoria_models.dart';

part 'session_state.dart';

/// Who is signed in. The api client's `TokenProvider` reads `state.token`,
/// so every feature's calls carry the current identity without passing it.
class SessionCubit extends Cubit<SessionState> {
  new() : super(const SessionState.unauthenticated());

  String? get token => state.session?.token;

  void signedIn(Session session) => emit(SessionState.authenticated(session));

  void signedOut() => emit(const SessionState.unauthenticated());
}
