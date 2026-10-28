import 'dart:convert';

import 'package:gel/gel.dart' as gel;
import 'package:http/http.dart' as http;

/// Host tools the chat model can call. OpenClaw keeps its own; Parasail
/// and Ollama run these here so memory and the web stay on the server.
class ChatToolbox {
  ChatToolbox({
    required this.searchMemory,
    required this.recentMemory,
    required this.getMemory,
    required this.remember,
    required this.lifeGraph,
    this.youApiKey,
    this.disabled = const {},
    http.Client? httpClient,
  }) : _http = httpClient ?? http.Client();

  final Future<List<Map<String, dynamic>>> Function(
    gel.Client c,
    String query,
    int limit,
  )
  searchMemory;
  final Future<List<Map<String, dynamic>>> Function(gel.Client c, int limit)
  recentMemory;
  final Future<Map<String, dynamic>?> Function(gel.Client c, String id)
  getMemory;
  final Future<String> Function(gel.Client c, String title, String? body)
  remember;
  final Future<Map<String, dynamic>?> Function(gel.Client c) lifeGraph;
  final String? youApiKey;
  final Set<String> disabled;
  final http.Client _http;

  bool get webAvailable => youApiKey != null && youApiKey!.isNotEmpty;

  bool isOn(String name) => !disabled.contains(name);

  List<Map<String, dynamic>> get catalog => [
    _info(
      'memory_search',
      "Search the user's personal memory (notes, events, people, places).",
    ),
    _info('memory_recent', 'Most recent items in the memory feed.'),
    _info('memory_get', 'Fetch one memory by id.'),
    _info('remember', 'Save a note the user asked to keep.'),
    _info('life_graph', 'Goals, projects, habits, people and relationships.'),
    _info(
      'web_search',
      'Search the public web (You.com). Use for news, facts, places.',
      available: webAvailable,
    ),
    _info('now', 'Current local date and time.'),
  ];

  /// OpenAI `tools` array. Omit unavailable or switched-off tools.
  List<Map<String, dynamic>> get definitions => [
    if (isOn('memory_search'))
      _fn(
        'memory_search',
        "Search the user's personal memory.",
        {
          'query': {'type': 'string'},
          'limit': {'type': 'integer'},
        },
        const ['query'],
      ),
    if (isOn('memory_recent'))
      _fn('memory_recent', 'Most recent memories.', {
        'limit': {'type': 'integer'},
      }),
    if (isOn('memory_get'))
      _fn(
        'memory_get',
        'Fetch one memory by id.',
        {
          'id': {'type': 'string'},
        },
        const ['id'],
      ),
    if (isOn('remember'))
      _fn(
        'remember',
        'Save a note to memory.',
        {
          'title': {'type': 'string'},
          'body': {'type': 'string'},
        },
        const ['title'],
      ),
    if (isOn('life_graph'))
      _fn(
        'life_graph',
        'The life graph: goals, projects, habits, entities, edges.',
      ),
    if (webAvailable && isOn('web_search'))
      _fn(
        'web_search',
        'Search the public web. Returns titles, URLs and snippets.',
        {
          'query': {'type': 'string'},
        },
        const ['query'],
      ),
    if (isOn('now')) _fn('now', 'Current local date and time.'),
  ];

  Future<String> run(gel.Client c, String name, String rawArgs) async {
    Map<String, dynamic> args;
    try {
      final parsed = rawArgs.trim().isEmpty
          ? const <String, dynamic>{}
          : jsonDecode(rawArgs);
      args = parsed is Map<String, dynamic>
          ? parsed
          : const <String, dynamic>{};
    } on FormatException {
      args = const <String, dynamic>{};
    }
    try {
      return switch (name) {
        'now' => DateTime.now().toIso8601String(),
        'memory_search' => formatMemories(
          await searchMemory(c, '${args['query'] ?? ''}', _int(args['limit'], 8)),
        ),
        'memory_recent' => formatMemories(
          await recentMemory(c, _int(args['limit'], 10)),
        ),
        'memory_get' => formatMemory(await getMemory(c, '${args['id'] ?? ''}')),
        'remember' =>
          'saved ${await remember(c, '${args['title'] ?? 'note'}', args['body'] as String?)}',
        'life_graph' => formatGraph(await lifeGraph(c)),
        'web_search' => await _webSearch('${args['query'] ?? ''}'),
        _ => 'unknown tool $name',
      };
    } on Object catch (e) {
      return 'error: $e';
    }
  }

  Future<String> _webSearch(String query) async {
    if (!webAvailable) return 'web search is not configured';
    final q = query.trim();
    if (q.isEmpty) return 'query required';
    final r = await _http.get(
      Uri.https('api.you.com', '/v1/search', {'query': q, 'count': '5'}),
      headers: {'X-API-Key': youApiKey!},
    );
    if (r.statusCode >= 400) {
      return 'web search failed (${r.statusCode})';
    }
    final json = jsonDecode(r.body) as Map<String, dynamic>;
    final hits =
        ((json['results'] as Map<String, dynamic>?)?['web'] as List<dynamic>?) ??
        const [];
    if (hits.isEmpty) return 'no results';
    return hits
        .take(5)
        .map((h) {
          final m = h as Map<String, dynamic>;
          return '${m['title']}: ${m['description'] ?? m['url']}';
        })
        .join('\n');
  }

  static String formatMemories(List<Map<String, dynamic>> rows) {
    if (rows.isEmpty) return 'no memories';
    return rows.map(formatMemoryRow).join('\n');
  }

  static String formatMemory(Map<String, dynamic>? row) {
    if (row == null) return 'not found';
    return formatMemoryRow(row);
  }

  static String formatMemoryRow(Map<String, dynamic> row) {
    final title = row['title'] ?? row['kind'] ?? 'memory';
    final body = row['body'];
    final when = row['occurred_at'] ?? row['created_at'];
    final snippet = body == null
        ? ''
        : ': ${body.toString().replaceAll(RegExp(r'\s+'), ' ')}';
    final cut = snippet.length > 240 ? '${snippet.substring(0, 237)}…' : snippet;
    return '${row['id']}  $title$cut${when == null ? '' : '  ($when)'}';
  }

  static String formatGraph(Map<String, dynamic>? g) {
    if (g == null) return 'empty graph';
    final buf = StringBuffer();
    void list(String label, Object? raw) {
      final rows = raw as List<dynamic>? ?? const [];
      if (rows.isEmpty) return;
      buf.writeln('$label:');
      for (final r in rows.take(20)) {
        final m = r as Map<String, dynamic>;
        final extra = m['summary'] ?? m['why'] ?? m['kind'] ?? '';
        buf.writeln(
          extra.toString().isEmpty
              ? '- ${m['name']}'
              : '- ${m['name']} ($extra)',
        );
      }
    }

    list('goals', g['goals']);
    list('projects', g['projects']);
    list('habits', g['habits']);
    list('entities', g['entities']);
    final edges = g['edges'] as List<dynamic>? ?? const [];
    if (edges.isNotEmpty) {
      buf.writeln('edges:');
      for (final e in edges.take(30)) {
        final m = e as Map<String, dynamic>;
        final src = (m['source'] as Map<String, dynamic>?)?['name'];
        final tgt = (m['target'] as Map<String, dynamic>?)?['name'];
        buf.writeln('- $src ${m['kind']} $tgt (${m['status']})');
      }
    }
    return buf.isEmpty ? 'empty graph' : buf.toString().trim();
  }

  static int _int(Object? v, int fallback) {
    if (v is int) return v.clamp(1, 40);
    if (v is num) return v.toInt().clamp(1, 40);
    return fallback;
  }

  static Map<String, dynamic> _info(
    String name,
    String description, {
    bool available = true,
  }) => {
    'name': name,
    'description': description,
    'available': available,
  };

  List<Map<String, dynamic>> catalogFor() => [
    for (final t in catalog)
      {...t, 'enabled': isOn(t['name'] as String), 'available': t['available']},
  ];

  static Map<String, dynamic> _fn(
    String name,
    String description, [
    Map<String, dynamic> properties = const {},
    List<String> required = const [],
  ]) => {
    'type': 'function',
    'function': {
      'name': name,
      'description': description,
      'parameters': {
        'type': 'object',
        'properties': properties,
        if (required.isNotEmpty) 'required': required,
      },
    },
  };
}
