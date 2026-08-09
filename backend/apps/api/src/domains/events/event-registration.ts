import { DEFAULT_QUEUE } from './constants';
import type { QueueOptions } from './types';

export class EventListenerRegistry {
  private static listeners = new Map<string, { className: string; methodName: string; queue: string }>();

  // Queue-level options requested via @OnEvent({ queueOptions }). Keyed by
  // queue name; conflicting explicit values from different listeners throw at
  // registration (decorator evaluation) so a misconfiguration fails fast.
  private static queueOptions = new Map<string, QueueOptions>();

  static register(
    eventName: string,
    className: string,
    methodName: string,
    queue: string = DEFAULT_QUEUE,
    queueOptions?: QueueOptions,
  ) {
    const key = `${eventName}:${queue}`;
    const existing = this.listeners.get(key);

    if (existing) {
      throw new Error(
        `Multiple listeners detected for event ${eventName} in queue ${queue}. ` +
          `Existing: ${existing.className}.${existing.methodName}, ` +
          `New: ${className}.${methodName}. ` +
          `Only one listener per event per queue is allowed.`,
      );
    }

    this.listeners.set(key, {
      className,
      methodName,
      queue,
    });

    if (queueOptions) {
      const current = this.queueOptions.get(queue) ?? {};

      for (const [option, value] of Object.entries(queueOptions) as [keyof QueueOptions, number][]) {
        const existingValue = current[option];

        if (existingValue !== undefined && existingValue !== value) {
          throw new Error(
            `Conflicting queueOptions.${option} for queue ${queue}: ` +
              `${existingValue} already registered, ${className}.${methodName} requests ${value}.`,
          );
        }

        current[option] = value;
      }

      this.queueOptions.set(queue, current);
    }
  }

  static getListeners() {
    return Array.from(this.listeners.entries());
  }

  static getQueueOptions(queue: string): QueueOptions | undefined {
    return this.queueOptions.get(queue);
  }

  static clear() {
    this.listeners.clear();
    this.queueOptions.clear();
  }
}

class EventDefinitionRegistry {
  private static names = new Set<string>();

  /**
   * Event registration helper method used to enforce event payload constraints
   * at compile time and name uniqueness at runtime.
   */
  static defineEvent<T extends Record<string, unknown> & { name?: never }>(name: string) {
    if (this.names.has(name)) {
      throw new Error(`Event name "${name}" is already registered.`);
    }

    this.names.add(name);

    return {} as T;
  }
}

export function defineEvent<T extends Record<string, unknown> & { name?: never }>(name: string) {
  return EventDefinitionRegistry.defineEvent<T>(name);
}
