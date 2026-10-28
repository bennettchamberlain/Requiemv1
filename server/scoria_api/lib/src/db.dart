import 'package:gel/gel.dart';
import 'package:scoria_api/src/config.dart';

/// Gel/Napalm connections for the two roles this process plays.
class Db {
  Db._(this._root);

  final Client _root;

  factory Db.connect(Config c) {
    final client = createClient(
      dsn: c.gelDsn,
      tlsSecurity: c.gelTlsInsecure ? TLSSecurity.insecure : TLSSecurity.strict,
    );
    return Db._(client);
  }

  /// Runs as the signed-in person. Policies apply.
  Client asPerson(String personId) =>
      _root.withGlobals({'current_person_id': personId});

  /// Runs with no identity. Only policies with no identity requirement pass.
  Client get anonymous => _root;

  /// Credential lookups only. Sets `service_mode` so `LocalCredential`
  /// becomes visible; nothing else in the schema reads that global.
  Client get service => _root.withGlobals({'service_mode': true});

  /// Seeding and admin operations that must bypass policies entirely.
  /// Never used on a request path.
  Client get bypass => _root.withConfig({'apply_access_policies': false});

  Future<void> close() => _root.close();
}
