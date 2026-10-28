/// A claimed job. `data` is the JSON payload written at `send` time.
class Job {
  const Job({
    required this.id,
    required this.name,
    required this.data,
    required this.expireIn,
    this.retryCount = 0,
  });

  final String id;
  final String name;
  final Map<String, dynamic> data;
  final Duration expireIn;
  final int retryCount;

  @override
  String toString() => 'Job($name/$id, retry=$retryCount)';
}

/// Per-queue defaults, stored in `pgboss.queue` by `create_queue`.
class QueueOptions {
  const QueueOptions({
    this.policy = QueuePolicy.standard,
    this.retryLimit = 2,
    this.retryDelay = const Duration(seconds: 1),
    this.retryBackoff = true,
    this.expireIn = const Duration(minutes: 15),
    this.retention = const Duration(days: 14),
    this.deadLetter,
  });

  final QueuePolicy policy;
  final int retryLimit;
  final Duration retryDelay;
  final bool retryBackoff;
  final Duration expireIn;
  final Duration retention;
  final String? deadLetter;

  Map<String, dynamic> toJson() => {
    'policy': policy.name,
    'retryLimit': retryLimit,
    'retryDelay': retryDelay.inSeconds,
    'retryBackoff': retryBackoff,
    'expireInSeconds': expireIn.inSeconds,
    'retentionMinutes': retention.inMinutes,
    if (deadLetter != null) 'deadLetter': deadLetter,
  };
}

/// pg-boss queue policies. `singleton`/`stately` dedupe on `singleton_key`.
enum QueuePolicy { standard, short, singleton, stately }

/// Options for one `send`.
class SendOptions {
  const SendOptions({
    this.id,
    this.priority = 0,
    this.startAfter,
    this.singletonKey,
    this.retryLimit,
    this.retryDelay,
    this.retryBackoff,
    this.expireIn,
  });

  final String? id;
  final int priority;
  final Duration? startAfter;
  final String? singletonKey;
  final int? retryLimit;
  final Duration? retryDelay;
  final bool? retryBackoff;
  final Duration? expireIn;
}
