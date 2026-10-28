import 'dart:async';

import 'package:scoria_jobs/src/job.dart';
import 'package:scoria_jobs/src/pgboss_queue.dart';

/// Handles one job. Throw to fail it (pg-boss retry semantics apply).
typedef JobHandler = Future<Object?> Function(Job job);

/// Polls queues and dispatches to handlers. One runner per worker process.
///
/// Polling, not LISTEN/NOTIFY, on purpose for v1: it is what pg-boss does by
/// default and keeps the runner correct when the backend Postgres is reached
/// through anything that drops async notifications.
class JobRunner {
  JobRunner(
    this.queue, {
    this.pollInterval = const Duration(seconds: 2),
    this.batchSize = 5,
    this.expireSweep = const Duration(minutes: 1),
    void Function(String message, [Object? error])? log,
  }) : _log = log ?? ((m, [e]) {});

  final PgBossQueue queue;
  final Duration pollInterval;
  final int batchSize;
  final Duration expireSweep;
  final void Function(String message, [Object? error]) _log;

  final _handlers = <String, JobHandler>{};
  final _timers = <Timer>[];
  bool _running = false;

  /// Registers [handler] for [name] and ensures the queue exists.
  Future<void> work(
    String name,
    JobHandler handler, [
    QueueOptions? options,
  ]) async {
    await queue.createQueue(name, options ?? const QueueOptions());
    _handlers[name] = handler;
  }

  Future<void> start() async {
    if (_running) return;
    _running = true;
    _timers
      ..add(Timer.periodic(pollInterval, (_) => _tick()))
      ..add(Timer.periodic(expireSweep, (_) => _sweep()));
    unawaited(_tick());
  }

  Future<void> stop() async {
    _running = false;
    for (final t in _timers) {
      t.cancel();
    }
    _timers.clear();
  }

  Future<void> _sweep() async {
    try {
      await queue.failExpired();
    } catch (e) {
      _log('expire sweep failed', e);
    }
  }

  Future<void> _tick() async {
    if (!_running) return;
    for (final entry in _handlers.entries) {
      List<Job> jobs;
      try {
        jobs = await queue.fetch(entry.key, batchSize: batchSize);
      } catch (e) {
        _log('fetch ${entry.key} failed', e);
        continue;
      }
      for (final job in jobs) {
        unawaited(_run(entry.value, job));
      }
    }
  }

  Future<void> _run(JobHandler handler, Job job) async {
    try {
      final out = await handler(job).timeout(job.expireIn);
      await queue.complete(job.name, job.id, out);
    } catch (e, st) {
      _log('job $job failed', e);
      _log(st.toString());
      try {
        await queue.fail(job.name, job.id, e);
      } catch (e2) {
        _log('could not mark $job failed', e2);
      }
    }
  }
}
