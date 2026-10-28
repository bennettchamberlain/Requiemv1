import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:scoria_api_client/scoria_api_client.dart';
import 'package:test/test.dart';

void main() {
  ScoriaApiClient client(http.Client inner, {String? token}) => ScoriaApiClient(
    baseUrl: Uri.parse('http://localhost:8080/'),
    tokenProvider: () => token,
    httpClient: inner,
  );

  test('sends bearer token and parses feed', () async {
    final c = client(
      MockClient((req) async {
        expect(req.headers['authorization'], 'Bearer tok');
        expect(req.url.path, '/memory');
        return http.Response(
          jsonEncode([
            {
              'id': '1',
              'kind': 'note',
              'occurred_at': '2026-10-19T00:00:00Z',
              'source': 's',
            },
          ]),
          200,
        );
      }),
      token: 'tok',
    );
    final feed = await c.memoryFeed();
    expect(feed.single.kind, 'note');
  });

  test('maps errors to ScoriaApiException', () async {
    final c = client(
      MockClient(
        (_) async => http.Response(
          jsonEncode({'code': 'unauthorized', 'message': 'no'}),
          401,
        ),
      ),
    );
    expect(
      c.me(),
      throwsA(
        isA<ScoriaApiException>().having(
          (e) => e.isUnauthorized,
          'unauth',
          true,
        ),
      ),
    );
  });
}
