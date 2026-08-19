import { defineEvent } from '@ci/domains/events';

import type { SmartRotationWorkType } from './types';

export const SmartRotationWorkEvent = 'smart.rotation.work';

export type SmartRotationWorkPayload = {
  userId: string;
  workType: SmartRotationWorkType;
};

defineEvent<SmartRotationWorkPayload>(SmartRotationWorkEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [SmartRotationWorkEvent]: SmartRotationWorkPayload;
  }
}
