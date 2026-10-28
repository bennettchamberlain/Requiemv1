/// One raw location sample from the Flutter background location stream.
/// Shape matches `position_insert_many.edgeql`.
class PositionPoint {
  const PositionPoint({
    required this.at,
    required this.lat,
    required this.lng,
    this.accuracyM,
    this.speedMps,
    this.source,
    this.deviceId,
  });

  factory PositionPoint.fromJson(Map<String, dynamic> json) => PositionPoint(
    at: DateTime.parse(json['at'] as String),
    lat: (json['lat'] as num).toDouble(),
    lng: (json['lng'] as num).toDouble(),
    accuracyM: (json['accuracy_m'] as num?)?.toDouble(),
    speedMps: (json['speed_mps'] as num?)?.toDouble(),
    source: json['source'] as String?,
    deviceId: json['device_id'] as String?,
  );

  final DateTime at;
  final double lat;
  final double lng;
  final double? accuracyM;
  final double? speedMps;
  final String? source;
  final String? deviceId;

  Map<String, dynamic> toJson() => {
    'at': at.toUtc().toIso8601String(),
    'lat': lat,
    'lng': lng,
    if (accuracyM != null) 'accuracy_m': accuracyM,
    if (speedMps != null) 'speed_mps': speedMps,
    if (source != null) 'source': source,
    if (deviceId != null) 'device_id': deviceId,
  };
}
