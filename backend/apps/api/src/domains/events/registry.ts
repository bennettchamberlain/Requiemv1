const nameRegistry = new Set<string>();

/**
 * Event registration helper method used to enforce event payload constraints at
 * compile time and name uniqueness at runtime.
 */
export function defineEvent<T extends Record<string, unknown> & { name?: never }>(name: string) {
  if (nameRegistry.has(name)) {
    throw new Error(`Event name "${name}" is already registered.`);
  }

  nameRegistry.add(name);

  return {} as T;
}

/**
 * This interface is the single source of truth for all registered events. It
 * should be extended via declaration merging from different domain event files.
 *
 * @example
 *
 * import { defineEvent } from '@ci/domains/events/registry';
 * export const UserCreatedEvent = 'user.created';
 *
 * export type UserCreatedPayload = {
 *   userId: string;
 * };
 *
 * defineEvent<UserCreatedPayload>(UserCreatedEvent);

 * declare module '@ci/domains/events/registry' {
 *   interface EventRegistry {
 *     [UserCreatedEvent]: UserCreatedPayload;
 *   }
 * }
 */
export interface EventRegistry {
  [key: string]: object;
  [key: number]: never;
  [key: symbol]: never;
}
