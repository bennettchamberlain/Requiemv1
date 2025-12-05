import { defineEvent } from '@ci/domains/events';

/**
 * Event emitted when creating a new content.
 *
 * @see {@link ContentService.create} - The method that emits this event
 */
export const ContentCreatedEvent = 'content.created';
export const ContentUpdatedEvent = 'content.updated';
export const ContentRemovedEvent = 'content.deleted';

/**
 * Event payload of the event {@link ContentCreatedEvent}.
 *
 * @see {@link ContentCreatedEvent} - The event this payload is associated with
 * @see {@link ContentService.create} - The method that emits this event payload
 */
export type ContentCreatedPayload = {
  /** The identifier of the newly created content */
  contentId: string;
};

/**
 * Event payload of the event {@link ContentUpdatedEvent}.
 *
 * @see {@link ContentUpdatedEvent} - The event this payload is associated with
 * @see {@link ContentService.update} - The method that emits this event payload
 */
export type ContentUpdatedPayload = {
  /** The identifier of the newly created content */
  contentId: string;
};

/**
 * Event payload of the event {@link ContentRemovedEvent}.
 *
 * @see {@link ContentRemovedEvent} - The event this payload is associated with
 * @see {@link ContentService.remove} - The method that emits this event payload
 */
export type ContentDeletedPayload = {
  /** The identifier of the newly created content */
  contentId: string;
};

defineEvent<ContentCreatedPayload>(ContentCreatedEvent);
defineEvent<ContentUpdatedPayload>(ContentUpdatedEvent);
defineEvent<ContentDeletedPayload>(ContentRemovedEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [ContentCreatedEvent]: ContentCreatedPayload;
    [ContentUpdatedEvent]: ContentUpdatedPayload;
    [ContentRemovedEvent]: ContentDeletedPayload;
  }
}
