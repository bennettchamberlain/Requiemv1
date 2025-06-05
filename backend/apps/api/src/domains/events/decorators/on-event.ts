import { OnEvent as BaseOnEvent } from '@nestjs/event-emitter';

import type { EventPayloads } from '../event-registry';

type EventNameType = keyof EventPayloads;

export function OnEvent<E extends EventNameType>(event: E) {
  return BaseOnEvent(event);
}
