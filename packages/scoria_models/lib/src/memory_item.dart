import 'package:scoria_models/src/person.dart';
import 'package:scoria_models/src/place.dart';

/// A memory as returned by `memory_feed` / `memory_get` / `memory_search`.
class MemoryItem {
  const MemoryItem({
    required this.id,
    required this.kind,
    required this.occurredAt,
    required this.source,
    this.title,
    this.body,
    this.sourceId,
    this.owner,
    this.place,
    this.distance,
  });

  factory MemoryItem.fromJson(Map<String, dynamic> json) => MemoryItem(
    id: json['id'] as String,
    kind: json['kind'] as String,
    title: json['title'] as String?,
    body: json['body'] as String?,
    occurredAt: DateTime.parse(json['occurred_at'] as String),
    source: json['source'] as String? ?? '',
    sourceId: json['source_id'] as String?,
    owner: json['owner'] == null
        ? null
        : Person.fromJson(json['owner'] as Map<String, dynamic>),
    place: json['place'] == null
        ? null
        : Place.fromJson(json['place'] as Map<String, dynamic>),
    distance: (json['distance'] as num?)?.toDouble(),
  );

  final String id;
  final String kind;
  final String? title;
  final String? body;
  final DateTime occurredAt;
  final String source;
  final String? sourceId;
  final Person? owner;
  final Place? place;

  /// Cosine distance when returned by `memory_search`; otherwise null.
  final double? distance;

  Map<String, dynamic> toJson() => {
    'id': id,
    'kind': kind,
    'title': title,
    'body': body,
    'occurred_at': occurredAt.toIso8601String(),
    'source': source,
    'source_id': sourceId,
    'owner': owner?.toJson(),
    'place': place?.toJson(),
    'distance': distance,
  };
}

/// Input for `memory_upsert`. Idempotent on (owner, source, sourceId).
class MemoryUpsert {
  const MemoryUpsert({
    required this.kind,
    required this.occurredAt,
    required this.source,
    required this.sourceId,
    this.title,
    this.body,
  });

  final String kind;
  final String? title;
  final String? body;
  final DateTime occurredAt;
  final String source;
  final String sourceId;

  Map<String, dynamic> toJson() => {
    'kind': kind,
    'title': title,
    'body': body,
    'occurred_at': occurredAt.toUtc().toIso8601String(),
    'source': source,
    'source_id': sourceId,
  };
}
