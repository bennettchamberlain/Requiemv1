import { defineEvent } from '@ci/domains/events';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { UserService } from './services/UserService';

/**
 * Event emitted when creating a new user.
 *
 * @see {@link UserService.create} - The method that emits this event
 */
export const UserCreatedEvent = 'user.created';

/**
 * Event payload of the event {@link UserCreatedEvent}.
 *
 * @see {@link UserCreatedEvent} - The event this payload is associated with
 * @see {@link UserService.create} - The method that emits this event payload
 */
export type UserCreatedPayload = {
  /** The identifier of the newly created user */
  userId: string;
};

defineEvent<UserCreatedPayload>(UserCreatedEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [UserCreatedEvent]: UserCreatedPayload;
  }
}
