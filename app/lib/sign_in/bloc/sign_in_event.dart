part of 'sign_in_bloc.dart';

sealed class SignInEvent extends Equatable {
  const new();

  @override
  List<Object?> get props => [];
}

final class SignInHandleChanged extends SignInEvent {
  const new(this.handle);
  final String handle;

  @override
  List<Object?> get props => [handle];
}

final class SignInPasswordChanged extends SignInEvent {
  const new(this.password);
  final String password;

  @override
  List<Object?> get props => [password];
}

final class SignInSubmitted extends SignInEvent {
  const new();
}
