import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// A geocoder answer, provider-neutral. Maps onto `Place`.
class GeoPlace {
  const GeoPlace({
    required this.name,
    required this.lat,
    required this.lng,
    required this.provider,
    required this.providerId,
    this.city,
    this.region,
    this.country,
  });

  final String name;
  final String? city;
  final String? region;
  final String? country;
  final double lat;
  final double lng;
  final String provider;
  final String providerId;

  Map<String, dynamic> toJson() => {
    'name': name,
    'city': city,
    'region': region,
    'country': country,
    'lat': lat,
    'lng': lng,
    'provider': provider,
    'provider_id': providerId,
  };
}

/// Forward and reverse geocoding.
///
/// Two providers: Google Geocoding when a key is configured, otherwise
/// Nominatim (OpenStreetMap), which needs no key but asks for one request
/// per second and an identifying User-Agent — both enforced here. Results
/// are cached by caller (`Place` rows) so a trail of positions around one
/// spot costs a single lookup.
class Geocoder {
  Geocoder({
    this.googleApiKey,
    this.userAgent = 'scoria-api (self-hosted)',
    http.Client? client,
  }) : _http = client ?? http.Client();

  final String? googleApiKey;
  final String userAgent;
  final http.Client _http;

  String get provider => googleApiKey == null ? 'nominatim' : 'google';

  /// Grid key for cache lookups: ~110 m cells.
  static String gridKey(double lat, double lng) =>
      '${lat.toStringAsFixed(3)},${lng.toStringAsFixed(3)}';

  Future<GeoPlace?> reverse(double lat, double lng) => googleApiKey == null
      ? _nominatimReverse(lat, lng)
      : _googleReverse(lat, lng);

  Future<List<GeoPlace>> search(String query, {int limit = 5}) =>
      googleApiKey == null
      ? _nominatimSearch(query, limit)
      : _googleSearch(query, limit);

  // ---- Nominatim ------------------------------------------------------------

  DateTime _nextAllowed = DateTime.fromMillisecondsSinceEpoch(0);

  /// Serialises calls to one per second as Nominatim's usage policy asks.
  Future<Map<String, dynamic>?> _nominatim(
    String path,
    Map<String, String> q,
  ) async {
    final now = DateTime.now();
    if (now.isBefore(_nextAllowed)) {
      await Future<void>.delayed(_nextAllowed.difference(now));
    }
    _nextAllowed = DateTime.now().add(const Duration(milliseconds: 1100));
    final uri = Uri.https('nominatim.openstreetmap.org', path, {
      ...q,
      'format': 'jsonv2',
      'addressdetails': '1',
    });
    final r = await _http
        .get(uri, headers: {'user-agent': userAgent, 'accept-language': 'en'})
        .timeout(const Duration(seconds: 10));
    if (r.statusCode != 200) return null;
    final body = jsonDecode(r.body);
    return body is Map<String, dynamic> ? body : {'results': body};
  }

  Future<GeoPlace?> _nominatimReverse(double lat, double lng) async {
    final j = await _nominatim('/reverse', {
      'lat': '$lat',
      'lon': '$lng',
      'zoom': '17',
    });
    if (j == null || j['error'] != null) return null;
    return _fromNominatim(j);
  }

  Future<List<GeoPlace>> _nominatimSearch(String query, int limit) async {
    final j = await _nominatim('/search', {'q': query, 'limit': '$limit'});
    final results = j?['results'] as List<dynamic>? ?? const [];
    return [
      for (final r in results)
        if (_fromNominatim(r as Map<String, dynamic>) case final p?) p,
    ];
  }

  GeoPlace? _fromNominatim(Map<String, dynamic> j) {
    final addr = j['address'] as Map<String, dynamic>? ?? const {};
    final lat = double.tryParse('${j['lat']}');
    final lng = double.tryParse('${j['lon']}');
    if (lat == null || lng == null) return null;
    final city =
        addr['city'] ??
        addr['town'] ??
        addr['village'] ??
        addr['hamlet'] ??
        addr['municipality'] ??
        addr['county'];
    final road = addr['road'];
    final name = (j['name'] as String?)?.trim().isNotEmpty ?? false
        ? j['name'] as String
        : road != null
        ? [
            if (addr['house_number'] != null) addr['house_number'],
            road,
          ].join(' ')
        : (j['display_name'] as String? ?? 'Unknown place')
              .split(',')
              .first
              .trim();
    return GeoPlace(
      name: name,
      city: city as String?,
      region: addr['state'] as String?,
      country: addr['country'] as String?,
      lat: lat,
      lng: lng,
      provider: 'nominatim',
      providerId: '${j['osm_type']}:${j['osm_id']}',
    );
  }

  // ---- Google ---------------------------------------------------------------

  Future<Map<String, dynamic>?> _google(Map<String, String> q) async {
    final uri = Uri.https('maps.googleapis.com', '/maps/api/geocode/json', {
      ...q,
      'key': googleApiKey!,
    });
    final r = await _http.get(uri).timeout(const Duration(seconds: 10));
    if (r.statusCode != 200) return null;
    final j = jsonDecode(r.body) as Map<String, dynamic>;
    if (j['status'] != 'OK') return null;
    return j;
  }

  Future<GeoPlace?> _googleReverse(double lat, double lng) async {
    final j = await _google({'latlng': '$lat,$lng'});
    final results = j?['results'] as List<dynamic>? ?? const [];
    return results.isEmpty
        ? null
        : _fromGoogle(results.first as Map<String, dynamic>);
  }

  Future<List<GeoPlace>> _googleSearch(String query, int limit) async {
    final j = await _google({'address': query});
    final results = j?['results'] as List<dynamic>? ?? const [];
    return [
      for (final r in results.take(limit))
        _fromGoogle(r as Map<String, dynamic>),
    ];
  }

  GeoPlace _fromGoogle(Map<String, dynamic> r) {
    String? comp(String type, {bool short = false}) {
      for (final c in r['address_components'] as List<dynamic>) {
        final m = c as Map<String, dynamic>;
        if ((m['types'] as List<dynamic>).contains(type)) {
          return (short ? m['short_name'] : m['long_name']) as String?;
        }
      }
      return null;
    }

    final loc =
        (r['geometry'] as Map<String, dynamic>)['location']
            as Map<String, dynamic>;
    final route = comp('route');
    final name = route != null
        ? [
            if (comp('street_number') != null) comp('street_number'),
            route,
          ].join(' ')
        : comp('premise') ??
              comp('neighborhood') ??
              (r['formatted_address'] as String).split(',').first;
    return GeoPlace(
      name: name,
      city: comp('locality') ?? comp('postal_town') ?? comp('sublocality'),
      region: comp('administrative_area_level_1'),
      country: comp('country'),
      lat: (loc['lat'] as num).toDouble(),
      lng: (loc['lng'] as num).toDouble(),
      provider: 'google',
      providerId: r['place_id'] as String,
    );
  }
}
