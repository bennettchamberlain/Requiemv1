export class EventRegistry {
  private static names = new Set<string>();

  static define<T extends Record<string, unknown>>(name: string): T {
    if (EventRegistry.names.has(name)) {
      throw new Error(`Event name "${name}" is already registered.`);
    }

    EventRegistry.names.add(name);

    return {} as T;
  }
}
