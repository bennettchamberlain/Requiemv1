import { defineEvent } from '@ci/domains/events';

import type { PythonFunctionRunPayload } from './types';

export const PythonFunctionRunEvent = 'python.function.run';

defineEvent<PythonFunctionRunPayload>(PythonFunctionRunEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [PythonFunctionRunEvent]: PythonFunctionRunPayload;
  }
}
