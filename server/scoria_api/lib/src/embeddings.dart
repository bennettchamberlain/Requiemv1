import 'dart:convert';

import 'package:http/http.dart' as http;

/// Embeds text with Ollama (`/api/embeddings`). 768 dims for nomic-embed-text.
class Embeddings {
  Embeddings({required this.baseUrl, required this.model, http.Client? client})
    : _http = client ?? http.Client();

  final Uri baseUrl;
  final String model;
  final http.Client _http;

  Future<List<double>> embed(String text) async {
    final r = await _http.post(
      baseUrl.resolve('api/embeddings'),
      headers: {'content-type': 'application/json'},
      body: jsonEncode({'model': model, 'prompt': text}),
    );
    if (r.statusCode != 200) {
      throw StateError('ollama ${r.statusCode}: ${r.body}');
    }
    final json = jsonDecode(r.body) as Map<String, dynamic>;
    return (json['embedding'] as List<dynamic>)
        .map((e) => (e as num).toDouble())
        .toList();
  }
}
