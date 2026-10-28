import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

/// PBKDF2-HMAC-SHA256 password hashing. Encoded as
/// `pbkdf2-sha256$iterations$salt_b64$hash_b64`.
///
/// Stands in for Napalm LocalAuth (argon2/scrypt) until the Napalm server
/// is the runtime; `LocalCredential.algorithm` records which one wrote it.
class Password {
  const Password({this.iterations = 210000});

  final int iterations;

  static final _rng = Random.secure();

  String hash(String password) {
    final salt = Uint8List.fromList(
      List.generate(16, (_) => _rng.nextInt(256)),
    );
    final dk = _pbkdf2(utf8.encode(password), salt, iterations, 32);
    return 'pbkdf2-sha256\$$iterations\$${base64.encode(salt)}\$${base64.encode(dk)}';
  }

  bool verify(String password, String encoded) {
    final parts = encoded.split(r'$');
    if (parts.length != 4 || parts[0] != 'pbkdf2-sha256') return false;
    final iters = int.tryParse(parts[1]);
    if (iters == null) return false;
    final salt = base64.decode(parts[2]);
    final expected = base64.decode(parts[3]);
    final actual = _pbkdf2(utf8.encode(password), salt, iters, expected.length);
    return _constantTimeEquals(actual, expected);
  }

  static Uint8List _pbkdf2(
    List<int> password,
    List<int> salt,
    int iterations,
    int length,
  ) {
    final mac = Hmac(sha256, password);
    final out = BytesBuilder();
    var block = 1;
    while (out.length < length) {
      final blockBytes = ByteData(4)..setUint32(0, block);
      var u = Uint8List.fromList(
        mac.convert([...salt, ...blockBytes.buffer.asUint8List()]).bytes,
      );
      final t = Uint8List.fromList(u);
      for (var i = 1; i < iterations; i++) {
        u = Uint8List.fromList(mac.convert(u).bytes);
        for (var j = 0; j < t.length; j++) {
          t[j] ^= u[j];
        }
      }
      out.add(t);
      block++;
    }
    return Uint8List.fromList(out.toBytes().sublist(0, length));
  }

  static bool _constantTimeEquals(List<int> a, List<int> b) {
    if (a.length != b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) {
      diff |= a[i] ^ b[i];
    }
    return diff == 0;
  }
}
