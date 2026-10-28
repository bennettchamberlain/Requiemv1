/// A person on the cluster. `isSuperadmin` manages accounts; it does not
/// widen data visibility.
class Person {
  const Person({
    required this.id,
    required this.handle,
    this.displayName,
    this.email,
    this.isSuperadmin = false,
    this.createdAt,
  });

  factory Person.fromJson(Map<String, dynamic> json) => Person(
    id: json['id'] as String,
    handle: json['handle'] as String,
    displayName: json['display_name'] as String?,
    email: json['email'] as String?,
    isSuperadmin: json['is_superadmin'] as bool? ?? false,
    createdAt: json['created_at'] == null
        ? null
        : DateTime.parse(json['created_at'] as String),
  );

  final String id;
  final String handle;
  final String? displayName;
  final String? email;
  final bool isSuperadmin;
  final DateTime? createdAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'handle': handle,
    'display_name': displayName,
    'email': email,
    'is_superadmin': isSuperadmin,
    'created_at': createdAt?.toIso8601String(),
  };
}
