/// A life-graph node as returned by `/graph` and weave candidates.
class GraphThing {
  const GraphThing({
    required this.id,
    required this.name,
    this.summary,
    this.dataClass,
    this.kind,
  });

  factory GraphThing.fromJson(Map<String, dynamic> json) => GraphThing(
    id: json['id'] as String,
    name: json['name'] as String,
    summary: json['summary'] as String?,
    dataClass: json['data_class'] as String?,
    kind: json['kind'] as String?,
  );

  final String id;
  final String name;
  final String? summary;
  final String? dataClass;
  final String? kind;

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'summary': summary,
    'data_class': dataClass,
    'kind': kind,
  };
}

class GraphEdge {
  const GraphEdge({
    required this.id,
    required this.kind,
    required this.status,
    this.evidence,
    this.source,
    this.target,
  });

  factory GraphEdge.fromJson(Map<String, dynamic> json) => GraphEdge(
    id: json['id'] as String,
    kind: json['kind'] as String,
    status: json['status'] as String,
    evidence: json['evidence'] as String?,
    source: json['source'] == null
        ? null
        : GraphThing.fromJson(json['source'] as Map<String, dynamic>),
    target: json['target'] == null
        ? null
        : GraphThing.fromJson(json['target'] as Map<String, dynamic>),
  );

  final String id;
  final String kind;
  final String status;
  final String? evidence;
  final GraphThing? source;
  final GraphThing? target;

  Map<String, dynamic> toJson() => {
    'id': id,
    'kind': kind,
    'status': status,
    'evidence': evidence,
    'source': source?.toJson(),
    'target': target?.toJson(),
  };
}
