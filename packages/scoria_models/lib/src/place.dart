/// Geocoder output. Shared reference data, not owned by a person.
class Place {
  const Place({
    required this.id,
    required this.name,
    this.city,
    this.region,
    this.country,
    this.lat,
    this.lng,
  });

  factory Place.fromJson(Map<String, dynamic> json) => Place(
    id: json['id'] as String,
    name: json['name'] as String,
    city: json['city'] as String?,
    region: json['region'] as String?,
    country: json['country'] as String?,
    lat: (json['lat'] as num?)?.toDouble(),
    lng: (json['lng'] as num?)?.toDouble(),
  );

  final String id;
  final String name;
  final String? city;
  final String? region;
  final String? country;
  final double? lat;
  final double? lng;

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'city': city,
    'region': region,
    'country': country,
    'lat': lat,
    'lng': lng,
  };
}
