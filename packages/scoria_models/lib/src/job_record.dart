/// PGBoss job state, mirrored in `JobState` in the schema.
enum JobState {
  created,
  retry,
  active,
  completed,
  cancelled,
  failed;

  static JobState parse(String value) => JobState.values.firstWhere(
    (s) => s.name == value,
    orElse: () => JobState.created,
  );
}

/// A job as the jobs page sees it (`jobs_list`). Worker writes these.
class JobRecord {
  const JobRecord({
    required this.id,
    required this.name,
    required this.state,
    required this.createdAt,
    this.attempt = 0,
    this.startedAt,
    this.completedAt,
    this.error,
    this.subjectId,
    this.subjectClass,
  });

  factory JobRecord.fromJson(Map<String, dynamic> json) {
    final subject = json['subject'] as Map<String, dynamic>?;
    return JobRecord(
      id: json['id'] as String,
      name: json['name'] as String,
      state: JobState.parse(json['state'] as String),
      attempt: json['attempt'] as int? ?? 0,
      createdAt: DateTime.parse(json['created_at'] as String),
      startedAt: json['started_at'] == null
          ? null
          : DateTime.parse(json['started_at'] as String),
      completedAt: json['completed_at'] == null
          ? null
          : DateTime.parse(json['completed_at'] as String),
      error: json['error'] as String?,
      subjectId: subject?['id'] as String?,
      subjectClass: subject?['data_class'] as String?,
    );
  }

  final String id;
  final String name;
  final JobState state;
  final int attempt;
  final DateTime createdAt;
  final DateTime? startedAt;
  final DateTime? completedAt;
  final String? error;
  final String? subjectId;
  final String? subjectClass;

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'state': state.name,
    'attempt': attempt,
    'created_at': createdAt.toIso8601String(),
    'started_at': startedAt?.toIso8601String(),
    'completed_at': completedAt?.toIso8601String(),
    'error': error,
    'subject': subjectId == null
        ? null
        : {'id': subjectId, 'data_class': subjectClass},
  };
}
