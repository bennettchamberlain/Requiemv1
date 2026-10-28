import 'package:scoria_api/scoria_api.dart';
import 'package:test/test.dart';

void main() {
  group('Password', () {
    const p = Password(iterations: 1000);
    test('verifies its own hash and rejects others', () {
      final h = p.hash('correct horse');
      expect(p.verify('correct horse', h), isTrue);
      expect(p.verify('wrong', h), isFalse);
      expect(p.verify('x', 'garbage'), isFalse);
    });
  });

  group('SessionToken', () {
    const t = SessionToken('a-very-long-secret-at-least-32-chars!!');
    test('round-trips and expires', () {
      final exp = DateTime.utc(2030);
      final tok = t.issue('person-1', exp);
      expect(t.verify(tok, now: DateTime.utc(2029)), 'person-1');
      expect(t.verify(tok, now: DateTime.utc(2031)), isNull);
      expect(t.verify('$tok.x'), isNull);
      expect(
        const SessionToken('another-secret-that-is-32-chars-long!!')
            .verify(tok),
        isNull,
      );
    });
  });
}
