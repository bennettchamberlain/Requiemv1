/// A Dart job runner over the pg-boss 10 schema.
///
/// Wire-compatible with pg-boss 10.3 (`pgboss.job` partitioned by queue,
/// `pgboss.create_queue`, the same `job_state` enum and retry/backoff math),
/// so existing tooling that reads `pgboss.job` / `pgboss.archive` still works.
///
/// Connects to the **raw backend Postgres** under Napalm, never through the
/// Gel SQL adapter: that adapter cannot CREATE, LISTEN, or NOTIFY.
library;

export 'src/job.dart';
export 'src/job_runner.dart';
export 'src/pgboss_queue.dart';
export 'src/pgboss_schema.dart';
