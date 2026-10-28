import 'dart:convert';

import 'package:http/http.dart' as http;

/// Cloud embeddings via Parasail's OpenAI-compatible `/v1/embeddings`.
///
/// Live event model is `parasail-bge-m3` (1024-dim). GritLM-7B was not
/// reachable on the issued key.
class ParasailEmbeddings {
  ParasailEmbeddings({
    required this.apiKey,
    required this.model,
    this.baseUrl = 'https://api.parasail.io/v1',
    http.Client? client,
  }) : _http = client ?? http.Client();

  final String apiKey;
  final String model;
  final String baseUrl;
  final http.Client _http;

  Future<List<double>> embed(String text) async {
    final r = await _http.post(
      Uri.parse('$baseUrl/embeddings'),
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer $apiKey',
      },
      body: jsonEncode({
        'model': model,
        'input': text,
        'encoding_format': 'float',
      }),
    );
    if (r.statusCode != 200) {
      throw StateError('parasail embeddings ${r.statusCode}: ${r.body}');
    }
    final json = jsonDecode(r.body) as Map<String, dynamic>;
    final data = json['data'] as List<dynamic>;
    if (data.isEmpty) {
      throw StateError('parasail embeddings: empty data');
    }
    return ((data.first as Map<String, dynamic>)['embedding'] as List<dynamic>)
        .map((e) => (e as num).toDouble())
        .toList();
  }
}
