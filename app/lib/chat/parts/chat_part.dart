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
    _ => ChatText(type),
  };
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
  final seen = <String>{
    for (final segment in segments)
      if (segment is ChatBlock && segment.part is ChatWebSearch)
        (segment.part as ChatWebSearch).query,
  };
  for (final tool in tools) {
    final query = _queryFromTool(tool);
    if (query == null || !seen.add(query)) continue;
    segments.add(ChatBlock(_searchPart(query, tool.result)));
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
