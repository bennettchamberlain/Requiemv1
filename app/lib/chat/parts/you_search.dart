import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:scoria_app/config/app_config.dart';

/// One ranked page from You.com Web Search.
class YouHit {
  const new({
    required this.title,
    required this.url,
    this.description = '',
    this.snippets = const [],
    this.pageAge,
  });

  final String title;
  final String url;
  final String description;
  final List<String> snippets;
  final String? pageAge;

  /// Reads `results.web` and `results.news` from a `/v1/search` body.
  static List<YouHit> listFromResponse(Object? raw) {
    if (raw is! Map) return const [];
    final results = raw['results'];
    if (results is! Map) return const [];
    final hits = <YouHit>[];
    for (final section in ['web', 'news']) {
      final rows = results[section];
      if (rows is! List) continue;
      for (final row in rows) {
        if (row is! Map) continue;
        final title = row['title'];
        final url = row['url'];
        if (title is! String || url is! String || url.isEmpty) continue;
        final snippets = row['snippets'];
        hits.add(
          YouHit(
            title: title,
            url: url,
            description: row['description'] is String
                ? row['description']! as String
                : '',
            snippets: snippets is List
                ? [for (final s in snippets) if (s is String) s]
                : const [],
            pageAge: row['page_age'] is String
                ? row['page_age']! as String
                : null,
          ),
        );
      }
    }
    return hits;
  }
}

class YouSearchException implements Exception {
  const new(this.message);

  final String message;

  @override
  String toString() => message;
}

/// `POST https://ydc-index.io/v1/search`. Snippets, not full-page extraction.
class YouSearchClient {
  new({http.Client? httpClient, String? apiKey})
    : _http = httpClient ?? http.Client(),
      _ownsClient = httpClient == null,
      apiKey = apiKey ?? AppConfig.ydcApiKey;

  final http.Client _http;
  final bool _ownsClient;
  final String apiKey;

  Future<List<YouHit>> search(String query) async {
    final trimmed = query.trim();
    if (trimmed.isEmpty) return const [];
    if (apiKey.isEmpty) {
      throw const YouSearchException(
        'Web search needs a YDC_API_KEY.',
      );
    }
    final response = await _http.post(
      Uri.parse('https://ydc-index.io/v1/search'),
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'query': trimmed, 'count': 5}),
    );
    if (response.statusCode != 200) {
      throw YouSearchException(
        'Web search failed (${response.statusCode}).',
      );
    }
    final decoded = jsonDecode(response.body);
    return YouHit.listFromResponse(decoded);
  }

  void close() {
    if (_ownsClient) _http.close();
  }
}
