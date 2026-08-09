import type { EventPayloads } from './event-registry';

export type Acknowledgement = {
  done: () => void;
  fail: (reason: unknown) => void;

  /**
   * Release the worker slot WITHOUT completing or failing the job. The job
   * stays `active` in pg-boss until something calls
   * {@link EventService.completeJob} / {@link EventService.failJob} with its id
   * (e.g. a webhook from an external executor), or until the queue's
   * `expireInSeconds` elapses and pg-boss retries it. Only meaningful with
   * `autoAcknowledge: false`; LocalEventService treats it as `done`.
   */
  defer: () => void;
};

/**
 * pg-boss queue-level options a listener can request for its queue. Applied at
 * queue creation/update on module init by the pg-boss implementation; ignored
 * by LocalEventService.
 */
export type QueueOptions = {
  /** Seconds an `active` job may run before pg-boss expires (and retries) it. */
  expireInSeconds?: number;

  /** Retry attempts before the job is routed to the dead-letter queue. */
  retryLimit?: number;

  /** Seconds between retries (with pg-boss's backoff applied on top). */
  retryDelay?: number;
};

export type EventPayload<E extends keyof EventPayloads> = EventPayloads[E];

/**
 * Options accepted by {@link EventService.send} and {@link EventService.sendMany}.
 */
export type EventSendOptions = {
  /**
   * Send to this one queue instead of fanning out to every registered queue.
   * Ignored by `sendMany`, which always names its target queue positionally.
   */
  queue?: string;

  /**
   * Job priority. Higher is worked sooner; defaults to `DEFAULT_JOB_PRIORITY`
   * (0). Only the pg-boss implementation honours it — `LocalEventService` runs
   * listeners inline, so there is no queue to order.
   */
  priority?: number;

  /** pg-boss singleton key — suppresses duplicate pending jobs with the same key. */
  singletonKey?: string;
};
