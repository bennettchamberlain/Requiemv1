import 'dart:convert';

import 'package:crypto/crypto.dart';

/// Stateless bearer token: `base64url(personId.expiresEpoch).signature`.
///
/// HMAC-SHA256 over the payload with the server secret. The token names the
/// caller; nothing in a request body can choose a different person.
class SessionToken {
  const SessionToken(this.secret);

  final String secret;

  String issue(String personId, DateTime expiresAt) {
    final payload = base64Url.encode(
      utf8.encode('$personId.${expiresAt.toUtc().millisecondsSinceEpoch}'),
    );
    return '$payload.${_sign(payload)}';
  }

  /// Returns the person id, or null when invalid or expired.
  String? verify(String token, {DateTime? now}) {
    final dot = token.lastIndexOf('.');
    if (dot <= 0) return null;
    final payload = token.substring(0, dot);
    final sig = token.substring(dot + 1);
    if (!_constantTimeEquals(sig, _sign(payload))) return null;
    final String decoded;
    try {
      decoded = utf8.decode(base64Url.decode(payload));
    } on FormatException {
      return null;
    }
    final sep = decoded.lastIndexOf('.');
    if (sep <= 0) return null;
    final personId = decoded.substring(0, sep);
    final exp = int.tryParse(decoded.substring(sep + 1));
    if (exp == null) return null;
    final expiresAt = DateTime.fromMillisecondsSinceEpoch(exp, isUtc: true);
    if (!(now ?? DateTime.now().toUtc()).isBefore(expiresAt)) return null;
    return personId;
  }

  String _sign(String payload) => base64Url.encode(
    Hmac(sha256, utf8.encode(secret)).convert(utf8.encode(payload)).bytes,
  );

  static bool _constantTimeEquals(String a, String b) {
    if (a.length != b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
    }
    return diff == 0;
  }
}
