import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:mocktail/mocktail.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:scoria_app/app/app.dart';
import 'package:scoria_app/home/home.dart';
import 'package:scoria_app/sign_in/sign_in.dart';
import 'package:scoria_models/scoria_models.dart';

class _MockApi extends Mock implements ScoriaApiClient;

void main() {
  group('App', () {
    testWidgets('shows sign-in, then home after a successful sign-in', (
      tester,
    ) async {
      final api = _MockApi();
      when(() => api.signIn(handle: 'admin', password: 'pw')).thenAnswer(
        (_) async => Session(
          token: 't',
          expiresAt: DateTime.utc(2030),
          person: const Person(id: 'p1', handle: 'admin', isSuperadmin: true),
        ),
      );
      when(api.memoryFeed).thenAnswer((_) async => []);
      when(() => api.jobs(limit: 200)).thenAnswer((_) async => []);

      await tester.pumpWidget(App(apiClient: api));
      expect(find.byType(SignInPage), findsOneWidget);

      await tester.enterText(
        find.byKey(const Key('signIn_handle_textField')),
        'admin',
      );
      await tester.enterText(
        find.byKey(const Key('signIn_password_textField')),
        'pw',
      );
      await tester.pump(); // let the bloc process the field events
      await tester.tap(find.byKey(const Key('signIn_submit_button')));
      await tester.pumpAndSettle();

      expect(find.byType(HomePage), findsOneWidget);
      expect(find.text('Nothing here yet.'), findsOneWidget);
    });
  });
}
