import { defineEvent } from '@ci/domains/events';

/**
 * Event emitted when creating a new connectionSyncJob.
 *
 * @see {@link ConnectionSyncJobService.create} - The method that emits this event
 */
export const ConnectionSyncJobExecuteEvent = 'connectionSyncJob.execute';

/**
 * Event payload of the event {@link ConnectionSyncJobExecuteEvent}.
 *
 * @see {@link ConnectionSyncJobExecuteEvent} - The event this payload is associated with
 */
export type ConnectionSyncJobExecutePayload = {
  /** The identifier of the newly created connectionSyncJob */
  connectionSyncJobId: string;
};

defineEvent<ConnectionSyncJobExecutePayload>(ConnectionSyncJobExecuteEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [ConnectionSyncJobExecuteEvent]: ConnectionSyncJobExecutePayload;
  }
}
