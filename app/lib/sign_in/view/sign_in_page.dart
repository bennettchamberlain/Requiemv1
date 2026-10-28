import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/config/server_cubit.dart';
import 'package:scoria_app/session/session.dart';
import 'package:scoria_app/sign_in/sign_in.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

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
            constraints: const BoxConstraints(maxWidth: 400),
            child: const Padding(
              padding: EdgeInsets.all(24),
              child: ShadCard(
                title: Text('Scoria'),
                description: Text(
                  'Sign in to the machine that holds memory.',
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _ServerField(),
                    SizedBox(height: 12),
                    _HandleField(),
                    SizedBox(height: 12),
                    _PasswordField(),
                    SizedBox(height: 16),
                    _ErrorText(),
                    _SubmitButton(),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Where the server is. Prefilled from the saved value; edits persist.
class _ServerField extends StatefulWidget {
  const new();

  @override
  State<_ServerField> createState() => _ServerFieldState();
}

class _ServerFieldState extends State<_ServerField> {
  late final _controller = TextEditingController(
    text: context.read<ServerCubit>().state,
  );

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final muted = ShadTheme.of(context).textTheme.muted;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _Label('Server'),
        ShadInput(
          key: const Key('signIn_server_textField'),
          controller: _controller,
          autocorrect: false,
          keyboardType: TextInputType.url,
          leading: const Icon(LucideIcons.server, size: 16),
          placeholder: const Text('http://localhost:8787'),
          onChanged: (v) => context.read<ServerCubit>().set(v),
        ),
        const SizedBox(height: 6),
        Text(
          'e.g. 192.168.1.20:8787 (your Scoria machine on Wi-Fi)',
          style: muted,
        ),
      ],
    );
  }
}

class _HandleField extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _Label('Handle'),
        ShadInput(
          key: const Key('signIn_handle_textField'),
          autocorrect: false,
          placeholder: const Text('Handle'),
          onChanged: (v) =>
              context.read<SignInBloc>().add(SignInHandleChanged(v)),
        ),
      ],
    );
  }
}

class _PasswordField extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _Label('Password'),
        ShadInput(
          key: const Key('signIn_password_textField'),
          obscureText: true,
          placeholder: const Text('Password'),
          onChanged: (v) =>
              context.read<SignInBloc>().add(SignInPasswordChanged(v)),
          onSubmitted: (_) =>
              context.read<SignInBloc>().add(const SignInSubmitted()),
        ),
      ],
    );
  }
}

class _Label extends StatelessWidget {
  const new(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(text, style: ShadTheme.of(context).textTheme.small),
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
      child: ShadAlert.destructive(
        title: const Text('Could not sign in'),
        description: Text(error),
      ),
    );
  }
}

class _SubmitButton extends StatelessWidget {
  const new();

  @override
  Widget build(BuildContext context) {
    final state = context.watch<SignInBloc>().state;
    final submitting = state.status == SignInStatus.submitting;
    return ShadButton(
      key: const Key('signIn_submit_button'),
      width: double.infinity,
      enabled: state.canSubmit,
      onPressed: state.canSubmit
          ? () => context.read<SignInBloc>().add(const SignInSubmitted())
          : null,
      child: submitting
          ? SizedBox.square(
              dimension: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: ShadTheme.of(context).colorScheme.primaryForeground,
              ),
            )
          : const Text('Sign in'),
    );
  }
}
