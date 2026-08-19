import { defineEvent } from '@ci/domains/events';

/** Delayed per-user self-heal after bulk `/v1` materialize. */
export const IngestCoalesceEvent = 'ingest.coalesce';

export type IngestCoalescePayload = {
  userId: string;
};

defineEvent<IngestCoalescePayload>(IngestCoalesceEvent);

declare module '@ci/domains/events/registry' {
  interface EventRegistry {
    [IngestCoalesceEvent]: IngestCoalescePayload;
  }
}
