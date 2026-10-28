import 'package:bloc/bloc.dart';
import 'package:equatable/equatable.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_models/scoria_models.dart';

part 'sign_in_event.dart';
part 'sign_in_state.dart';

class SignInBloc extends Bloc<SignInEvent, SignInState> {
  new({required this._api}) : super(const SignInState()) {
    on<SignInHandleChanged>(
      (e, emit) => emit(state.copyWith(handle: e.handle, clearError: true)),
    );
    on<SignInPasswordChanged>(
      (e, emit) => emit(state.copyWith(password: e.password, clearError: true)),
    );
    on<SignInSubmitted>(_onSubmitted);
  }

  final ScoriaApiClient _api;

  Future<void> _onSubmitted(
    SignInSubmitted event,
    Emitter<SignInState> emit,
  ) async {
    if (state.handle.isEmpty || state.password.isEmpty) return;
    emit(state.copyWith(status: SignInStatus.submitting, clearError: true));
    try {
      final session = await _api.signIn(
        handle: state.handle.trim(),
        password: state.password,
      );
      emit(state.copyWith(status: SignInStatus.success, session: session));
    } on ScoriaApiException catch (e) {
      emit(
        state.copyWith(
          status: SignInStatus.failure,
          error: e.statusCode == 401 ? 'Wrong handle or password' : e.message,
        ),
      );
    } on Exception catch (e) {
      emit(state.copyWith(status: SignInStatus.failure, error: '$e'));
    }
  }
}
