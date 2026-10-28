import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';

/// Machine credentials: `sk_<prefix>_<secret>`. Only `sha256(token)` is
/// stored, so a database read never yields a usable key. The prefix is
/// stored in clear so a key can be recognised in a list.
class ApiKeys {
  const ApiKeys();

  static final _rng = Random.secure();
  static const _alphabet =
      'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  static bool looksLikeKey(String s) => s.startsWith('sk_');

  /// Returns (token, prefix, hash). The token is shown to the caller once.
  ({String token, String prefix, String hash}) mint() {
    final prefix = _random(6);
    final token = 'sk_${prefix}_${_random(32)}';
    return (token: token, prefix: prefix, hash: hash(token));
  }

  String hash(String token) => sha256.convert(utf8.encode(token)).toString();

  static String _random(int n) => String.fromCharCodes(
    List.generate(n, (_) => _alphabet.codeUnitAt(_rng.nextInt(62))),
  );
}
