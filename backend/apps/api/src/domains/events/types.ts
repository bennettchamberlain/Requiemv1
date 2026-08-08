import type { EventPayloads } from './event-registry';

export type Acknowledgement = {
  done: () => void;
  fail: (reason: unknown) => void;
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
};
