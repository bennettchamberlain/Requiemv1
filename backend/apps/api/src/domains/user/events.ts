import { EventRegistry } from '@ci/domains/events';

/**
 * Emitted as a side-effect of creating a new user
 * with `UserService`.
 */
export const UserCreatedEvent = 'user.created';

const userCreated = EventRegistry.define<{
  userId: string;
}>(UserCreatedEvent);

export type UserCreatedPayload = typeof userCreated;

declare global {
  namespace Events {
    interface EventPayloads {
      [UserCreatedEvent]: UserCreatedPayload;
    }
  }
}
