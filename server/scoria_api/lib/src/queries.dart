import 'dart:io';

/// The named-query catalog: `schema/queries/*.edgeql` loaded once.
///
/// This is the same contract Napalm deploys at `/db/{id}/query/{name}`.
/// Until the server runs on Napalm proper, scoria-api executes the text
/// itself; the names and variables do not change when that switch happens.
class NamedQueries {
  NamedQueries._(this._queries);

  final Map<String, String> _queries;

  static Future<NamedQueries> load(String dir) async {
    final d = Directory(dir);
    if (!d.existsSync()) {
      throw StateError('queries dir not found: $dir');
    }
    final map = <String, String>{};
    await for (final f in d.list()) {
      if (f is File && f.path.endsWith('.edgeql')) {
        final name = f.uri.pathSegments.last.replaceAll('.edgeql', '');
        map[name] = await f.readAsString();
      }
    }
    return NamedQueries._(map);
  }

  String operator [](String name) {
    final q = _queries[name];
    if (q == null) throw ArgumentError.value(name, 'name', 'unknown query');
    return q;
  }

  Iterable<String> get names => _queries.keys;
}
