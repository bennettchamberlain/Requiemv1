/// Renders the life graph for the harness profile.
///
/// Verified relationships and containment are stated. Proposed edges are
/// counted and not named, so a guess is not repeated as a fact.
String lifeGraphBlock(Map<String, dynamic> graph) {
  final lines = <String>['## Life graph'];
  _things(lines, 'Projects', _list(graph['projects']), _project);
  _things(lines, 'Goals', _list(graph['goals']), _goal);
  _things(lines, 'Habits', _list(graph['habits']), _habit);
  final entities = _list(graph['entities']);
  if (entities.isNotEmpty) {
    lines.add('Entities:');
    final shown = entities.take(12);
    for (final entity in shown) {
      lines.add('- ${_entity(entity)}');
    }
    final rest = entities.length - shown.length;
    if (rest > 0) lines.add('- $rest more entities');
  }
  final verified = [
    for (final edge in _list(graph['edges']))
      if (edge['status'] == 'verified' && edge['kind'] != 'part_of')
        '- ${_edge(edge)}',
  ];
  if (verified.isNotEmpty) {
    lines.add('Verified relationships:');
    lines.addAll(verified);
  }
  final proposed = _list(graph['edges'])
      .where((edge) => edge['status'] == 'proposed')
      .length;
  if (proposed > 0) {
    lines.add(
      '$proposed proposed relationships are not established yet. '
      'Do not state them as fact.',
    );
  }
  return lines.length == 1 ? '' : lines.join('\n');
}

void _things(
  List<String> lines,
  String title,
  List<Map<String, dynamic>> rows,
  String Function(Map<String, dynamic> row) line,
) {
  if (rows.isEmpty) return;
  lines.add('$title:');
  for (final row in rows) {
    lines.add('- ${line(row)}');
  }
}

String _project(Map<String, dynamic> row) {
  final outcome = row['outcome'] as String?;
  return '${row['name']} (${row['status']})'
      '${_inside(row)}'
      '${outcome == null || outcome.isEmpty ? '' : ' — $outcome'}'
      '${_contains(row)}';
}

String _goal(Map<String, dynamic> row) {
  final why = row['why'] as String?;
  final on = row['target_on'] as String?;
  return '${row['name']} (${row['status']})'
      '${_inside(row)}'
      '${why == null || why.isEmpty ? '' : ' — $why'}'
      '${on == null ? '' : ' by $on'}'
      '${_contains(row)}';
}

String _habit(Map<String, dynamic> row) {
  final cadence = row['cadence'] as String?;
  final cue = row['cue'] as String?;
  final routine = row['routine'] as String?;
  final active = row['active'] == false ? 'inactive' : 'active';
  final detail = [
    if (cadence != null && cadence.isNotEmpty) cadence,
    if (cue != null && cue.isNotEmpty) 'cue: $cue',
    if (routine != null && routine.isNotEmpty) routine,
  ].join('; ');
  return '${row['name']} ($active)'
      '${_inside(row)}'
      '${detail.isEmpty ? '' : ' — $detail'}'
      '${_contains(row)}';
}

String _entity(Map<String, dynamic> row) =>
    '${row['name']} (${row['kind']})${_inside(row)}${_contains(row)}';

String _inside(Map<String, dynamic> row) {
  final parent = row['parent'];
  if (parent is! Map) return '';
  final name = parent['name'];
  return name is String && name.isNotEmpty ? ' inside $name' : '';
}

String _contains(Map<String, dynamic> row) {
  final names = [
    for (final part in _list(row['parts']))
      if (part['name'] is String) part['name'] as String,
  ];
  return names.isEmpty ? '' : '; contains ${names.join(', ')}';
}

String _edge(Map<String, dynamic> row) {
  final source = (row['source'] as Map?)?['name'] ?? '?';
  final target = (row['target'] as Map?)?['name'] ?? '?';
  return '$source ${_kind(row['kind'] as String?)} $target';
}

String _kind(String? kind) => switch (kind) {
  'supports' => 'supports',
  'pursues' => 'pursues',
  'practices' => 'practices',
  'prefers' => 'prefers',
  'dislikes' => 'dislikes',
  'located_at' => 'is located at',
  'knows' => 'knows',
  'related' => 'is related to',
  _ => kind ?? 'relates to',
};

List<Map<String, dynamic>> _list(Object? value) => [
  for (final item in value is List ? value : const [])
    if (item is Map) item.cast<String, dynamic>(),
];
