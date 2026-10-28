import 'dart:convert';

/// A model extraction checked against the memory it came from.
class Conclusion {
  const Conclusion({required this.things, required this.edges});

  final List<ConcludedThing> things;
  final List<ConcludedEdge> edges;

  static const empty = Conclusion(things: [], edges: []);

  /// Parses model JSON. A name that does not occur in [memoryText] is
  /// dropped, so a node the memory never said cannot enter the graph.
  static Conclusion parse(String raw, String memoryText) {
    final body = _jsonObject(raw);
    if (body == null) {
      throw FormatException('model did not return a JSON object');
    }
    final decoded = _asMap(_decode(body));
    final text = memoryText.toLowerCase();
    final things = <ConcludedThing>[];
    final names = <String>{};
    for (final item in _asList(decoded['things'])) {
      final thing = ConcludedThing._from(_asMap(item), text);
      if (thing == null || !names.add(thing.key)) continue;
      things.add(thing);
    }
    final edges = <ConcludedEdge>[];
    final seen = <String>{};
    void addEdge(String? source, String? target, String? kind) {
      final edge = ConcludedEdge._from(
        source: source,
        target: target,
        kind: kind,
        names: names,
        memory: memoryText,
      );
      if (edge != null && seen.add(edge.key)) edges.add(edge);
    }

    for (final edge in _absorbContainment(memoryText, text, things, names)) {
      if (seen.add(edge.key)) edges.add(edge);
    }
    for (final thing in things) {
      addEdge(thing.name, thing.parent, 'part_of');
    }
    for (final item in _asList(decoded['edges'])) {
      final m = _asMap(item);
      addEdge(
        m['source'] as String?,
        m['target'] as String?,
        m['kind'] as String?,
      );
    }
    return Conclusion(
      things: things,
      edges: [
        for (final edge in edges)
          if (edge.kind != 'part_of' || edge.stated) edge,
      ],
    );
  }
}

/// One goal, project, habit, or entity named by the memory.
class ConcludedThing {
  const ConcludedThing({
    required this.type,
    required this.name,
    this.kind,
    this.summary,
    this.why,
    this.outcome,
    this.cue,
    this.routine,
    this.cadence,
    this.status = 'active',
    this.active = true,
    this.targetOn,
    this.startedOn,
    this.parent,
  });

  final String type;
  final String name;
  final String? kind;
  final String? summary;
  final String? why;
  final String? outcome;
  final String? cue;
  final String? routine;
  final String? cadence;
  final String status;
  final bool active;
  final String? targetOn;
  final String? startedOn;
  final String? parent;

  String get key => '$type:${kind ?? ''}:${name.toLowerCase()}';

  static ConcludedThing? _from(Map<String, Object?> json, String text) {
    final type = json['type'];
    if (type is! String || !_types.contains(type)) return null;
    final name = _name(json['name'], text);
    if (name == null) return null;
    final kind = type == 'entity'
        ? _enum(json['kind'], _kinds, 'concept')
        : null;
    return ConcludedThing(
      type: type,
      name: name,
      kind: kind,
      summary: _short(json['summary'], 280),
      why: _short(json['why'], 280),
      outcome: _short(json['outcome'], 280),
      cue: _short(json['cue'], 120),
      routine: _short(json['routine'], 200),
      cadence: _short(json['cadence'], 40),
      status: _enum(json['status'], _statuses, 'active'),
      active: json['active'] is! bool || json['active']! as bool,
      targetOn: _day(json['target_on']),
      startedOn: _day(json['started_on']),
      parent: _name(json['parent'], text),
    );
  }

  static const _types = {'entity', 'goal', 'project', 'habit'};
  static const _kinds = {
    'person',
    'organization',
    'place',
    'object',
    'concept',
    'event',
  };
  static const _statuses = {'active', 'paused', 'done', 'dropped'};
}

/// A relationship the memory supports. Both ends were also extracted.
class ConcludedEdge {
  const ConcludedEdge({
    required this.source,
    required this.target,
    required this.kind,
    this.stated = false,
  });

  final String source;
  final String target;
  final String kind;

  /// True when the memory text itself says this containment.
  final bool stated;

  String get key => '${source.toLowerCase()}|$kind|${target.toLowerCase()}';

  static ConcludedEdge? _from({
    required String? source,
    required String? target,
    required String? kind,
    required Set<String> names,
    required String memory,
  }) {
    if (kind == null || !_kinds.contains(kind)) return null;
    final from = source?.trim();
    final to = target?.trim();
    if (from == null || to == null || from.isEmpty || to.isEmpty) return null;
    if (from.toLowerCase() == to.toLowerCase()) return null;
    if (!_known(from, names) || !_known(to, names)) return null;
    final stated = kind == 'part_of' && _statesContainment(memory, from, to);
    return ConcludedEdge(source: from, target: to, kind: kind, stated: stated);
  }

  static bool _statesContainment(String memory, String part, String whole) {
    final text = memory.toLowerCase();
    final p = part.toLowerCase();
    final w = whole.toLowerCase();
    return text.contains('$w contains $p') ||
        text.contains('$w contains the $p') ||
        text.contains('$p is part of $w') ||
        text.contains('$p is inside $w') ||
        text.contains('$p inside $w');
  }

  static bool _known(String name, Set<String> names) =>
      names.any((key) => key.endsWith(':${name.toLowerCase()}'));

  static const _kinds = {
    'part_of',
    'supports',
    'pursues',
    'practices',
    'prefers',
    'dislikes',
    'located_at',
    'knows',
    'related',
  };
}

/// How one more memory changes an edge that may already exist.
class EvidenceFold {
  const EvidenceFold({
    required this.status,
    required this.evidence,
    required this.changed,
  });

  final String status;
  final String evidence;

  /// False when the edge is rejected, or this memory is already cited.
  final bool changed;

  static EvidenceFold fold({
    required String? existingStatus,
    required String? existingEvidence,
    required String memoryId,
    required bool explicit,
  }) {
    if (existingStatus == 'rejected') {
      return EvidenceFold(
        status: 'rejected',
        evidence: existingEvidence ?? '',
        changed: false,
      );
    }
    final ids = _ids(existingEvidence);
    if (ids.contains(memoryId)) {
      return EvidenceFold(
        status: existingStatus ?? 'proposed',
        evidence: ids.join(','),
        changed: false,
      );
    }
    ids.add(memoryId);
    final earned = explicit || ids.length >= 2 ? 'verified' : 'proposed';
    return EvidenceFold(
      status: existingStatus == 'verified' ? 'verified' : earned,
      evidence: ids.join(','),
      changed: true,
    );
  }

  static List<String> _ids(String? evidence) => [
    for (final part in (evidence ?? '').split(','))
      if (part.trim().isNotEmpty) part.trim(),
  ];
}

final _contains = RegExp(
  r'\bcontains\b(?:\s+the)?\s+([A-Za-z][\w ]{1,40})',
  caseSensitive: false,
);

/// "Scoria contains the chat harness" is a row, not a guess. The container
/// is the nearest named thing (or capitalised word) before "contains".
List<ConcludedEdge> _absorbContainment(
  String memory,
  String text,
  List<ConcludedThing> things,
  Set<String> names,
) {
  final edges = <ConcludedEdge>[];
  for (final match in _contains.allMatches(memory)) {
    final part = _name(match.group(1), text);
    final whole = _containerBefore(memory, match.start, names, text);
    if (part == null || whole == null) continue;
    if (part.toLowerCase() == whole.toLowerCase()) continue;
    _ensureThing(things, names, whole);
    _ensureThing(things, names, part);
    edges.add(
      ConcludedEdge(source: part, target: whole, kind: 'part_of', stated: true),
    );
  }
  return edges;
}

String? _containerBefore(
  String memory,
  int containsAt,
  Set<String> names,
  String text,
) {
  final before = memory.substring(0, containsAt);
  String? best;
  var bestAt = -1;
  for (final key in names) {
    final name = key.substring(key.lastIndexOf(':') + 1);
    final at = before.toLowerCase().lastIndexOf(name);
    if (at > bestAt) {
      best = memory.substring(at, at + name.length);
      bestAt = at;
    }
  }
  if (best != null) return _name(best, text);
  final capitals = RegExp(r'\b([A-Z][\w]+)\b').allMatches(before);
  if (capitals.isEmpty) return null;
  return _name(capitals.last.group(1), text);
}

void _ensureThing(List<ConcludedThing> things, Set<String> names, String name) {
  if (names.any((key) => key.endsWith(':${name.toLowerCase()}'))) return;
  final thing = ConcludedThing(type: 'entity', name: name, kind: 'concept');
  if (names.add(thing.key)) things.add(thing);
}

String? _jsonObject(String raw) {
  final trimmed = raw.trim();
  final fence = RegExp(r'```(?:json)?\s*([\s\S]*?)```');
  final body = fence.firstMatch(trimmed)?.group(1)?.trim() ?? trimmed;
  final start = body.indexOf('{');
  final end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return body.substring(start, end + 1);
}

Object? _decode(String body) {
  try {
    return jsonDecode(body);
  } on FormatException {
    throw FormatException('model JSON did not parse');
  }
}

Map<String, Object?> _asMap(Object? value) =>
    value is Map ? value.cast<String, Object?>() : const {};

List<Object?> _asList(Object? value) => value is List ? value : const [];

String? _name(Object? value, String text) {
  if (value is! String) return null;
  final name = value.trim().replaceAll(RegExp(r'\s+'), ' ');
  if (name.length < 2 || name.length > 80) return null;
  if (!text.contains(name.toLowerCase())) return null;
  return name;
}

String? _short(Object? value, int max) {
  if (value is! String) return null;
  final text = value.trim();
  if (text.isEmpty) return null;
  return text.length <= max ? text : text.substring(0, max);
}

String? _day(Object? value) {
  if (value is! String) return null;
  return RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(value) ? value : null;
}

String _enum(Object? value, Set<String> allowed, String fallback) =>
    value is String && allowed.contains(value) ? value : fallback;
