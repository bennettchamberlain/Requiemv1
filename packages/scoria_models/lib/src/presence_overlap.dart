/// One day the caller and another person were in the same city.
/// Result row of `presence_overlap.edgeql`.
class PresenceOverlap {
  const PresenceOverlap({required this.day, this.city});

  factory PresenceOverlap.fromJson(Map<String, dynamic> json) =>
      PresenceOverlap(
        day: DateTime.parse(json['day'] as String),
        city: json['city'] as String?,
      );

  final DateTime day;
  final String? city;

  Map<String, dynamic> toJson() => {
    'day': day.toIso8601String().substring(0, 10),
    'city': city,
  };
}
