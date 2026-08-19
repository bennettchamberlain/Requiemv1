import { defineEvent } from '@ci/domains/events';

import type { ImportStagePayload } from './types';

/**
 * The importer's entire event surface: one event.
 *
 * A stage is a durable unit of work identified by a row, so the event carries
 * only which row. `unpack`, `parse` and `push` ride the same event and the same
 * generic worker, the way the pipeline's three queues carry every stage it will
 * ever have — adding a stage kind adds a runner, not an event, a listener and a
 * queue binding.
 *
 * Chaining is by re-emission: a stage that completes enqueues the next stage of
 * its run. The whole import is therefore a chain of durable jobs rather than one
 * long-lived job holding a worker slot across an entire 40GB import, which is
 * what makes a killed worker resumable at stage granularity.
 */
export const ImportStageEvent = 'import.stage';

defineEvent<ImportStagePayload>(ImportStageEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [ImportStageEvent]: ImportStagePayload;
  }
}
