import type { EventPayloads } from './event-registry';

export type Acknowledgement = {
  done: () => void;
  fail: (reason: unknown) => void;
};

export type EventPayload<E extends keyof EventPayloads> = EventPayloads[E];
