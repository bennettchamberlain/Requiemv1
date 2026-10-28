import 'dart:convert';

import 'package:equatable/equatable.dart';
import 'package:scoria_models/scoria_models.dart';

/// One node in a chat surface. Parts nest, the same way a catalog widget
/// would, but the set is the one this app renders.
sealed class ChatPart extends Equatable {
  const new();
}

final class ChatText extends ChatPart {
  const new(this.text);

  final String text;

  @override
  List<Object?> get props => [text];
}

final class ChatHeading extends ChatPart {
  const new(this.text);

  final String text;

  @override
  List<Object?> get props => [text];
}

final class ChatDivider extends ChatPart {
  const new();

  @override
  List<Object?> get props => const [];
}

final class ChatColumn extends ChatPart {
  const new(this.children);

  final List<ChatPart> children;

  @override
  List<Object?> get props => [children];
}

final class ChatRow extends ChatPart {
  const new(this.children);

  final List<ChatPart> children;

  @override
  List<Object?> get props => [children];
}

final class ChatList extends ChatPart {
  const new(this.children);

  final List<ChatPart> children;

  @override
  List<Object?> get props => [children];
}

final class ChatCard extends ChatPart {
  const new({
    required this.title,
    this.subtitle = '',
    this.children = const [],
    this.detail,
  });

  final String title;
  final String subtitle;
  final List<ChatPart> children;
  final ChatPart? detail;

  @override
  List<Object?> get props => [title, subtitle, children, detail];
}

final class ChatLink extends ChatPart {
  const new({
    required this.title,
    required this.url,
    this.snippet = '',
    this.detail,
  });

  final String title;
  final String url;
  final String snippet;
  final ChatPart? detail;

  @override
  List<Object?> get props => [title, url, snippet, detail];
}

final class ChatImage extends ChatPart {
  const new({required this.url, this.alt = ''});

  final String url;
  final String alt;

  @override
  List<Object?> get props => [url, alt];
}

/// Resolved by the client against You.com Web Search, then drawn as cards.
final class ChatWebSearch extends ChatPart {
  const new(this.query);

  final String query;

  @override
  List<Object?> get props => [query];
}

/// A line the device should speak. The chat still shows the prose.
final class ChatSpeech extends ChatPart {
  const new(this.text);

  final String text;

  @override
  List<Object?> get props => [text];
}

/// One memory the Gel policies already allowed this caller to see.
final class ChatMemory extends ChatPart {
  const new({
    required this.title,
    this.id = '',
    this.kind = 'note',
    this.when = '',
    this.body = '',
    this.place,
  });

  final String id;
  final String title;
  final String kind;
  final String when;
  final String body;
  final ChatPlace? place;

  @override
  List<Object?> get props => [id, title, kind, when, body, place];
}

final class ChatPlace extends ChatPart {
  const new({
    required this.name,
    this.city = '',
    this.region = '',
    this.country = '',
  });

  final String name;
  final String city;
  final String region;
  final String country;

  String get line => [
    name,
    if (city.isNotEmpty) city,
    if (region.isNotEmpty) region,
    if (country.isNotEmpty) country,
  ].join(', ');

  @override
  List<Object?> get props => [name, city, region, country];
}

final class ChatPerson extends ChatPart {
  const new({required this.name, this.handle = '', this.relation = ''});

  final String name;
  final String handle;
  final String relation;

  @override
  List<Object?> get props => [name, handle, relation];
}

final class ChatQuote extends ChatPart {
  const new(this.text, {this.attribution = ''});

  final String text;
  final String attribution;

  @override
  List<Object?> get props => [text, attribution];
}

final class ChatMetric extends ChatPart {
  const new({required this.value, this.label = '', this.detail = ''});

  final String value;
  final String label;
  final String detail;

  @override
  List<Object?> get props => [value, label, detail];
}

final class ChatBadge extends ChatPart {
  const new(this.text);

  final String text;

  @override
  List<Object?> get props => [text];
}

final class ChatTimeline extends ChatPart {
  const new({this.title = '', this.children = const []});

  final String title;
  final List<ChatPart> children;

  @override
  List<Object?> get props => [title, children];
}

final class ChatCheck extends ChatPart {
  const new(this.text, {this.done = false});

  final String text;
  final bool done;

  @override
  List<Object?> get props => [text, done];
}

final class ChatChecklist extends ChatPart {
  const new({this.title = '', this.items = const []});

  final String title;
  final List<ChatCheck> items;

  @override
  List<Object?> get props => [title, items];
}

final class ChatGraphNode extends Equatable {
  const new({
    required this.name,
    this.kind = '',
    this.subtitle = '',
    this.status = '',
  });

  final String name;
  final String kind;
  final String subtitle;
  final String status;

  @override
  List<Object?> get props => [name, kind, subtitle, status];
}

final class ChatGraphLink extends Equatable {
  const new({
    required this.source,
    required this.target,
    this.kind = '',
    this.status = '',
  });

  final String source;
  final String target;
  final String kind;
  final String status;

  @override
  List<Object?> get props => [source, target, kind, status];
}

/// Life graph: things plus edges Gel already scoped to this person.
final class ChatGraph extends ChatPart {
  const new({this.nodes = const [], this.edges = const []});

  final List<ChatGraphNode> nodes;
  final List<ChatGraphLink> edges;

  @override
  List<Object?> get props => [nodes, edges];
}

final class ChatAction extends Equatable {
  const new({required this.label, this.prompt = '', this.url = ''});

  final String label;
  final String prompt;
  final String url;

  @override
  List<Object?> get props => [label, prompt, url];
}

/// Buttons the user can tap — a prompt continues the chat.
final class ChatActions extends ChatPart {
  const new(this.items);

  final List<ChatAction> items;

  @override
  List<Object?> get props => [items];
}

/// A slice of an assistant message: prose, a parsed part, or a fence
/// that has not finished streaming yet.
sealed class ChatSegment extends Equatable {
  const new();
}

final class ChatProse extends ChatSegment {
  const new(this.text);

  final String text;

  @override
  List<Object?> get props => [text];
}

final class ChatBlock extends ChatSegment {
  const new(this.part);

  final ChatPart part;

  @override
  List<Object?> get props => [part];
}

final class ChatBlockPending extends ChatSegment {
  const new();

  @override
  List<Object?> get props => const [];
}

const _searchTools = {'web_search', 'you_search', 'you_web_search'};

/// Fence the model, or a dropped connection, uses to ask for a live search.
String scoriaWebSearchFence(String query) {
  final body = jsonEncode({'type': 'webSearch', 'query': query});
  return '```scoria\n$body\n```';
}

/// Splits [content] into prose and ```scoria fenced parts. [tools] named
/// `web_search` (or the You.com aliases) append a search surface.
List<ChatSegment> parseChatSegments(
  String content, {
  List<ChatToolCall> tools = const [],
}) {
  final segments = <ChatSegment>[];
  final complete = RegExp('```scoria[ \t]*\r?\n?([\\s\\S]*?)```');
  var cursor = 0;
  for (final match in complete.allMatches(content)) {
    _addProse(segments, content.substring(cursor, match.start));
    _addFence(segments, match.group(1) ?? '');
    cursor = match.end;
  }
  final rest = content.substring(cursor);
  final pendingAt = rest.indexOf('```scoria');
  final afterOpen = pendingAt < 0
      ? ''
      : rest.substring(pendingAt + '```scoria'.length);
  if (pendingAt >= 0 && !afterOpen.contains('```')) {
    _addProse(segments, rest.substring(0, pendingAt));
    segments.add(const ChatBlockPending());
  } else {
    _addProse(segments, rest);
  }
  _addTools(segments, tools);
  return segments;
}

ChatPart? partFromJson(Object? raw) {
  if (raw is! Map) return null;
  final type = raw['type'];
  if (type is! String) return null;
  String textOf(String key) => raw[key] is String ? raw[key]! as String : '';
  List<ChatPart> childrenOf() {
    final rawChildren = raw['children'];
    if (rawChildren is! List) return const [];
    return [
      for (final child in rawChildren) ?partFromJson(child),
    ];
  }

  final detail = partFromJson(raw['detail']);
  ChatPlace? placeOf() {
    final place = raw['place'];
    if (place is String && place.trim().isNotEmpty) {
      return ChatPlace(name: place.trim());
    }
    if (place is Map) {
      final typed = Map<String, dynamic>.from(place);
      typed.putIfAbsent('type', () => 'place');
      final part = partFromJson(typed);
      return part is ChatPlace ? part : null;
    }
    return null;
  }

  List<ChatCheck> checksOf() {
    final rawItems = raw['items'] ?? raw['children'];
    if (rawItems is! List) return const [];
    return [
      for (final item in rawItems)
        if (item is String)
          ChatCheck(item)
        else if (item is Map)
          ChatCheck(
            item['text'] is String ? item['text']! as String : '',
            done: item['done'] == true,
          ),
    ].where((c) => c.text.isNotEmpty).toList();
  }

  List<ChatAction> actionsOf() {
    final rawItems = raw['items'] ?? raw['actions'] ?? raw['children'];
    if (rawItems is! List) return const [];
    return [
      for (final item in rawItems)
        if (item is Map && (item['label'] is String || item['text'] is String))
          ChatAction(
            label: (item['label'] ?? item['text'])! as String,
            prompt: item['prompt'] is String ? item['prompt']! as String : '',
            url: item['url'] is String ? item['url']! as String : '',
          ),
    ];
  }

  return switch (type) {
    'text' => ChatText(textOf('text')),
    'heading' => ChatHeading(textOf('text')),
    'divider' => const ChatDivider(),
    'column' => ChatColumn(childrenOf()),
    'row' => ChatRow(childrenOf()),
    'list' => ChatList(childrenOf()),
    'card' => ChatCard(
      title: textOf('title'),
      subtitle: textOf('subtitle'),
      children: childrenOf(),
      detail: detail,
    ),
    'link' => ChatLink(
      title: textOf('title'),
      url: textOf('url'),
      snippet: textOf('snippet'),
      detail: detail,
    ),
    'image' => ChatImage(url: textOf('url'), alt: textOf('alt')),
    'webSearch' || 'web_search' => ChatWebSearch(textOf('query')),
    'speech' || 'speak' => ChatSpeech(textOf('text')),
    'memory' || 'memoryItem' => ChatMemory(
      id: textOf('id'),
      title: textOf('title').isEmpty ? textOf('kind') : textOf('title'),
      kind: textOf('kind').isEmpty ? 'note' : textOf('kind'),
      when: textOf('when').isEmpty ? textOf('occurred_at') : textOf('when'),
      body: textOf('body'),
      place: placeOf(),
    ),
    'place' => ChatPlace(
      name: textOf('name').isEmpty ? textOf('title') : textOf('name'),
      city: textOf('city'),
      region: textOf('region'),
      country: textOf('country'),
    ),
    'person' || 'entity' => ChatPerson(
      name: textOf('name').isEmpty ? textOf('title') : textOf('name'),
      handle: textOf('handle'),
      relation: textOf('relation').isEmpty ? textOf('kind') : textOf('relation'),
    ),
    'quote' => ChatQuote(textOf('text'), attribution: textOf('attribution')),
    'metric' || 'stat' => ChatMetric(
      value: textOf('value').isEmpty ? textOf('text') : textOf('value'),
      label: textOf('label'),
      detail: textOf('detail'),
    ),
    'badge' || 'tag' => ChatBadge(
      textOf('text').isEmpty ? textOf('label') : textOf('text'),
    ),
    'timeline' => ChatTimeline(
      title: textOf('title'),
      children: childrenOf(),
    ),
    'check' || 'item' => ChatCheck(textOf('text'), done: raw['done'] == true),
    'checklist' || 'checks' => ChatChecklist(
      title: textOf('title'),
      items: checksOf(),
    ),
    'graph' || 'lifeGraph' || 'life_graph' =>
        _graphFromJson(Map<Object?, Object?>.from(raw)),
    'actions' || 'actionRow' => ChatActions(actionsOf()),
    _ => ChatText(type),
  };
}

ChatGraph _graphFromJson(Map<Object?, Object?> raw) {
  ChatGraphNode nodeOf(Object? row, String kind) {
    if (row is! Map) return ChatGraphNode(name: '', kind: kind);
    final map = Map<Object?, Object?>.from(row);
    String read(String key) => map[key] is String ? map[key]! as String : '';
    return ChatGraphNode(
      name: read('name').isEmpty ? read('title') : read('name'),
      kind: read('kind').isEmpty ? kind : read('kind'),
      subtitle: read('subtitle').isEmpty
          ? (read('summary').isEmpty ? read('why') : read('summary'))
          : read('subtitle'),
      status: read('status'),
    );
  }

  final nodes = <ChatGraphNode>[
    for (final row in raw['nodes'] as List<dynamic>? ?? const [])
      nodeOf(row, ''),
    for (final row in raw['goals'] as List<dynamic>? ?? const [])
      nodeOf(row, 'goal'),
    for (final row in raw['projects'] as List<dynamic>? ?? const [])
      nodeOf(row, 'project'),
    for (final row in raw['habits'] as List<dynamic>? ?? const [])
      nodeOf(row, 'habit'),
    for (final row in raw['entities'] as List<dynamic>? ?? const [])
      nodeOf(row, 'entity'),
  ].where((n) => n.name.isNotEmpty).toList();

  final edges = <ChatGraphLink>[
    for (final row in raw['edges'] as List<dynamic>? ?? const [])
      if (row is Map)
        ChatGraphLink(
          source: _named(row['source']),
          target: _named(row['target']),
          kind: row['kind'] is String ? row['kind']! as String : '',
          status: row['status'] is String ? row['status']! as String : '',
        ),
  ].where((e) => e.source.isNotEmpty && e.target.isNotEmpty).toList();

  return ChatGraph(nodes: nodes, edges: edges);
}

String _named(Object? raw) {
  if (raw is String) return raw;
  if (raw is Map && raw['name'] is String) return raw['name']! as String;
  return '';
}

/// Lines to speak for a finished assistant message. Prefers `speech` parts,
/// then the first two sentences of prose.
List<String> spokenLinesOf(String content) {
  final spoken = <String>[];
  String? prose;
  for (final segment in parseChatSegments(content)) {
    switch (segment) {
      case ChatBlock(part: final ChatSpeech speech):
        final text = speech.text.trim();
        if (text.isNotEmpty) spoken.add(text);
      case ChatProse(:final text) when prose == null:
        prose = text;
      default:
        break;
    }
  }
  if (spoken.isNotEmpty) return spoken;
  final fallback = _spokenFallback(prose ?? '');
  return fallback.isEmpty ? const [] : [fallback];
}

String _spokenFallback(String text) {
  final plain = text
      .replaceAll(RegExp(r'\*\*(.+?)\*\*'), r'$1')
      .replaceAll(RegExp('`([^`]+)`'), r'$1')
      .replaceAll(RegExp(r'^#+\s*', multiLine: true), '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (plain.isEmpty) return '';
  final sentences = plain.split(RegExp(r'(?<=[.!?])\s+'));
  return sentences.take(2).join(' ').trim();
}

void _addProse(List<ChatSegment> segments, String raw) {
  final text = raw.trim();
  if (text.isEmpty) return;
  segments.add(ChatProse(text));
}

void _addFence(List<ChatSegment> segments, String body) {
  final trimmed = body.trim();
  if (trimmed.isEmpty) return;
  try {
    final decoded = jsonDecode(trimmed);
    if (decoded is List) {
      for (final item in decoded) {
        final part = partFromJson(item);
        if (part != null) segments.add(ChatBlock(part));
      }
      return;
    }
    final part = partFromJson(decoded);
    if (part != null) {
      segments.add(ChatBlock(part));
      return;
    }
  } on FormatException {
    segments.add(ChatProse(trimmed));
    return;
  }
  segments.add(ChatProse(trimmed));
}

void _addTools(List<ChatSegment> segments, List<ChatToolCall> tools) {
  final seenSearch = <String>{
    for (final segment in segments)
      if (segment is ChatBlock && segment.part is ChatWebSearch)
        (segment.part as ChatWebSearch).query,
  };
  final seenParts = <ChatPart>{
    for (final segment in segments)
      if (segment is ChatBlock) segment.part,
  };
  for (final tool in tools) {
    final query = _queryFromTool(tool);
    if (query != null) {
      if (!seenSearch.add(query)) continue;
      final part = _searchPart(query, tool.result);
      if (seenParts.add(part)) segments.add(ChatBlock(part));
      continue;
    }
    final part = _partFromToolResult(tool);
    if (part == null || !seenParts.add(part)) continue;
    segments.add(ChatBlock(part));
  }
}

/// Host tools now return GenUI JSON. The adapter draws it even when the
/// model did not repeat the fence.
ChatPart? _partFromToolResult(ChatToolCall tool) {
  final body = tool.result?.trim() ?? '';
  if (body.isEmpty) return null;
  try {
    return partFromJson(jsonDecode(body));
  } on FormatException {
    return null;
  }
}

/// A stored tool result is already text. An empty result still needs a fetch.
ChatPart _searchPart(String query, String? result) {
  final body = result?.trim() ?? '';
  if (body.isEmpty) return ChatWebSearch(query);
  if (body == 'no results' ||
      body == 'web search is not configured' ||
      body.startsWith('error:') ||
      body.startsWith('web search failed')) {
    return ChatColumn([ChatHeading(query), ChatText(body)]);
  }
  try {
    final decoded = jsonDecode(body);
    final fromJson = partFromJson(decoded);
    if (fromJson != null) return fromJson;
  } on FormatException {
    // Plain lines from the agent: "Title: snippet".
  }
  final cards = <ChatPart>[];
  for (final line in body.split('\n')) {
    final split = line.indexOf(': ');
    if (split <= 0) continue;
    final title = line.substring(0, split).trim();
    final snippet = line.substring(split + 2).trim();
    if (title.isEmpty) continue;
    cards.add(
      ChatCard(
        title: title,
        subtitle: snippet,
        detail: snippet.isEmpty ? null : ChatText(snippet),
      ),
    );
  }
  if (cards.isEmpty) return ChatColumn([ChatHeading(query), ChatText(body)]);
  return ChatColumn([ChatHeading(query), ...cards]);
}

String? _queryFromTool(ChatToolCall call) {
  if (!_searchTools.contains(call.name)) return null;
  final raw = call.arguments.trim();
  if (raw.isEmpty) return null;
  try {
    final decoded = jsonDecode(raw);
    if (decoded is Map && decoded['query'] is String) {
      final query = (decoded['query']! as String).trim();
      return query.isEmpty ? null : query;
    }
  } on FormatException {
    return raw;
  }
  return raw;
}
