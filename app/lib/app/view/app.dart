import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/config/app_config.dart';
import 'package:scoria_app/home/home.dart';
import 'package:scoria_app/l10n/l10n.dart';
import 'package:scoria_app/session/session.dart';
import 'package:scoria_app/sign_in/sign_in.dart';

class App extends StatelessWidget {
  const new({super.key, this.apiClient});

  /// Injected in tests; built from [AppConfig] otherwise.
  final ScoriaApiClient? apiClient;

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => SessionCubit(),
      child: Builder(
        builder: (context) {
          final session = context.read<SessionCubit>();
          return RepositoryProvider<ScoriaApiClient>(
            create: (_) =>
                apiClient ??
                ScoriaApiClient(
                  baseUrl: Uri.parse(AppConfig.apiUrl),
                  tokenProvider: () => session.token,
                ),
            child: const AppView(),
          );
        },
      ),
    );
  }
}

class AppView extends StatelessWidget {
  const new({super.key});

  @override
  Widget build(BuildContext context) {
    final status = context.select<SessionCubit, SessionStatus>(
      (c) => c.state.status,
    );
    return MaterialApp(
      theme: ThemeData(
        appBarTheme: AppBarTheme(
          backgroundColor: Theme.of(context).colorScheme.inversePrimary,
        ),
        useMaterial3: true,
      ),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: status == SessionStatus.authenticated
          ? const HomePage()
          : const SignInPage(),
    );
  }
}
