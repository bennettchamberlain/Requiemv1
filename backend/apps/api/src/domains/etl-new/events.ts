import { defineEvent } from '@ci/domains/events';

/**
 * Event emitted when creating a new connectionSyncJob.
 *
 * @see {@link ConnectionSyncJobService.create} - The method that emits this event
 */
export const ConnectionSyncJobCreatedEvent = 'connectionSyncJob.created';
export const ConnectionSyncJobUpdatedEvent = 'connectionSyncJob.updated';
export const ConnectionSyncJobDeletedEvent = 'connectionSyncJob.deleted';

/**
 * Event payload of the event {@link ConnectionSyncJobCreatedEvent}.
 *
 * @see {@link ConnectionSyncJobCreatedEvent} - The event this payload is associated with
 * @see {@link ConnectionSyncJobService.create} - The method that emits this event payload
 */
export type ConnectionSyncJobCreatedPayload = {
  /** The identifier of the newly created connectionSyncJob */
  connectionSyncJobId: string;
};

/**
 * Event payload of the event {@link ConnectionSyncJobUpdatedEvent}.
 *
 * @see {@link ConnectionSyncJobUpdatedEvent} - The event this payload is associated with
 * @see {@link ConnectionSyncJobService.update} - The method that emits this event payload
 */
export type ConnectionSyncJobUpdatedPayload = {
  /** The identifier of the newly created connectionSyncJob */
  connectionSyncJobId: string;
};

/**
 * Event payload of the event {@link ConnectionSyncJobDeletedEvent}.
 *
 * @see {@link ConnectionSyncJobDeletedEvent} - The event this payload is associated with
 * @see {@link ConnectionSyncJobService.delete} - The method that emits this event payload
 */
export type ConnectionSyncJobDeletedPayload = {
  /** The identifier of the newly created connectionSyncJob */
  connectionSyncJobId: string;
};

defineEvent<ConnectionSyncJobCreatedPayload>(ConnectionSyncJobCreatedEvent);
defineEvent<ConnectionSyncJobUpdatedPayload>(ConnectionSyncJobUpdatedEvent);
defineEvent<ConnectionSyncJobDeletedPayload>(ConnectionSyncJobDeletedEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [ConnectionSyncJobCreatedEvent]: ConnectionSyncJobCreatedPayload;
    [ConnectionSyncJobUpdatedEvent]: ConnectionSyncJobUpdatedPayload;
    [ConnectionSyncJobDeletedEvent]: ConnectionSyncJobDeletedPayload;
  }
}
