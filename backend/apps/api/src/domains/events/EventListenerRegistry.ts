import { DEFAULT_QUEUE } from './constants';

export class EventListenerRegistry {
  private static listeners = new Map<string, { className: string; methodName: string; queue: string }>();

  static register(eventName: string, className: string, methodName: string, queue: string = DEFAULT_QUEUE) {
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
  }

  static getListeners() {
    return Array.from(this.listeners.entries());
  }

  static clear() {
    this.listeners.clear();
  }
}
