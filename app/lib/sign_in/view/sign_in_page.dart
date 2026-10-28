import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/session/session.dart';
import 'package:scoria_app/sign_in/sign_in.dart';

class SignInPage extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (context) => SignInBloc(api: context.read<ScoriaApiClient>()),
      child: const SignInView(),
    );
  }
}

class SignInView extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocListener<SignInBloc, SignInState>(
      listenWhen: (p, c) => c.status == SignInStatus.success,
      listener: (context, state) {
        context.read<SessionCubit>().signedIn(state.session!);
      },
      child: Scaffold(
        body: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 360),
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'Scoria',
                    style: Theme.of(context).textTheme.headlineMedium,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 24),
                  const _HandleField(),
                  const SizedBox(height: 12),
                  const _PasswordField(),
                  const SizedBox(height: 16),
                  const _ErrorText(),
                  const _SubmitButton(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _HandleField extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: const Key('signIn_handle_textField'),
      autofocus: true,
      autocorrect: false,
      decoration: const InputDecoration(labelText: 'Handle'),
      onChanged: (v) => context.read<SignInBloc>().add(SignInHandleChanged(v)),
    );
  }
}

class _PasswordField extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    return TextField(
      key: const Key('signIn_password_textField'),
      obscureText: true,
      decoration: const InputDecoration(labelText: 'Password'),
      onChanged: (v) =>
          context.read<SignInBloc>().add(SignInPasswordChanged(v)),
      onSubmitted: (_) =>
          context.read<SignInBloc>().add(const SignInSubmitted()),
    );
  }
}

class _ErrorText extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    final error = context.select<SignInBloc, String?>((b) => b.state.error);
    if (error == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        error,
        style: TextStyle(color: Theme.of(context).colorScheme.error),
        textAlign: TextAlign.center,
      ),
    );
  }
}

class _SubmitButton extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<SignInBloc>().state;
    return FilledButton(
      key: const Key('signIn_submit_button'),
      onPressed: state.canSubmit
          ? () => context.read<SignInBloc>().add(const SignInSubmitted())
          : null,
      child: state.status == SignInStatus.submitting
          ? const SizedBox.square(
              dimension: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          : const Text('Sign in'),
    );
  }
}
