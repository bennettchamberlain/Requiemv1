import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:material_ui/material_ui.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/config/server_cubit.dart';
import 'package:scoria_app/home/home.dart';
import 'package:scoria_app/l10n/l10n.dart';
import 'package:scoria_app/session/session.dart';
import 'package:scoria_app/sign_in/sign_in.dart';
import 'package:scoria_app/ui/chrome.dart';
import 'package:shadcn_ui/shadcn_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

class App extends StatelessWidget {
  const new({super.key, this.apiClient, this.prefs});

  /// Injected in tests; built from [ServerCubit] otherwise.
  final ScoriaApiClient? apiClient;

  /// Persisted settings (server URL). Null in tests.
  final SharedPreferences? prefs;

  @override
  Widget build(BuildContext context) {
    return MultiBlocProvider(
      providers: [
        BlocProvider(create: (_) => SessionCubit()),
        BlocProvider(create: (_) => ServerCubit(prefs: prefs)),
      ],
      child: Builder(
        builder: (context) {
          final session = context.read<SessionCubit>();
          final server = context.read<ServerCubit>();
          return RepositoryProvider<ScoriaApiClient>(
            create: (_) =>
                apiClient ??
                ScoriaApiClient(
                  baseUrl: server.uri,
                  tokenProvider: () => session.token,
                ),
            child: BlocListener<ServerCubit, String>(
              // Re-point the live client when the user edits the URL.
              listener: (context, _) =>
                  context.read<ScoriaApiClient>().baseUrl = server.uri,
              child: const AppView(),
            ),
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
    return ShadApp(
      builder: scoriaMaterialTheme,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: status == SessionStatus.authenticated
          ? const HomePage()
          : const SignInPage(),
    );
  }
}
