import 'package:scoria_models/src/person.dart';

/// Result of `POST /auth/signin`. The token is the caller on later requests.
class Session {
  const Session({
    required this.token,
    required this.expiresAt,
    required this.person,
  });

  factory Session.fromJson(Map<String, dynamic> json) => Session(
    token: json['token'] as String,
    expiresAt: DateTime.parse(json['expires_at'] as String),
    person: Person.fromJson(json['person'] as Map<String, dynamic>),
  );

  final String token;
  final DateTime expiresAt;
  final Person person;

  Map<String, dynamic> toJson() => {
    'token': token,
    'expires_at': expiresAt.toIso8601String(),
    'person': person.toJson(),
  };
}
