part of 'sign_in_bloc.dart';

enum SignInStatus { idle, submitting, success, failure }

final class SignInState extends Equatable {
  const new({
    this.status = SignInStatus.idle,
    this.handle = '',
    this.password = '',
    this.error,
    this.session,
  });

  final SignInStatus status;
  final String handle;
  final String password;
  final String? error;
  final Session? session;

  bool get canSubmit =>
      handle.isNotEmpty &&
      password.isNotEmpty &&
      status != SignInStatus.submitting;

  SignInState copyWith({
    SignInStatus? status,
    String? handle,
    String? password,
    String? error,
    Session? session,
    bool clearError = false,
  }) {
    return SignInState(
      status: status ?? this.status,
      handle: handle ?? this.handle,
      password: password ?? this.password,
      error: clearError ? null : (error ?? this.error),
      session: session ?? this.session,
    );
  }

  @override
  List<Object?> get props => [status, handle, password, error, session?.token];
}
