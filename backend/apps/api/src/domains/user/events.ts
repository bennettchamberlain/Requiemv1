import { defineEvent } from '@ci/domains/events/registry';

/**
 * Emitted as a side-effect of creating a new user with `UserService`.
 */
export const UserCreatedEvent = 'user.created';

/**
 * Event payload of
 */
export type UserCreatedPayload = {
  userId: string;
};

defineEvent<UserCreatedPayload>(UserCreatedEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [UserCreatedEvent]: UserCreatedPayload;
  }
}
