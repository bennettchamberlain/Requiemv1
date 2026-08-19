import config from '@ci/configuration';

import { IMPORT_QUEUE, IMPORT_STAGE_QUEUE_BY_KIND } from '../../constants';
import { EventListenerRegistry } from '@ci/domains/events/event-registration';
import { ImportStageListener } from '../ImportStageListener';

/**
 * The bootstrap recovery sweep is the split topology's one actively harmful
 * duplicate: two processes racing resumeInterrupted() over the same runs.
 * Only the process that RUNS stages may recover them.
 */

const stubLogger = {
  setContext: jest.fn(),
  log: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};
const stage = (kind: string) => ({ kind }) as never;

function build() {
  const runs = { resumeInterrupted: jest.fn(async () => undefined) };
  const listener = new ImportStageListener(
    runs as never,
    {} as never,
    stage('unpack'),
    stage('parse'),
    stage('media'),
    stage('push'),
    stubLogger as never,
  );

  return { listener, runs };
}

async function bootUnderRole(role: 'all' | 'web' | 'worker') {
  const previous = config.role;

  (config as { role: string }).role = role;

  try {
    const { listener, runs } = build();

    await listener.onApplicationBootstrap();

    return runs.resumeInterrupted.mock.calls.length;
  } finally {
    (config as { role: string }).role = previous;
  }
}

describe('ImportStageListener bootstrap sweep role gating', () => {
  it('sweeps in worker and all, never in web', async () => {
    expect(await bootUnderRole('worker')).toBe(1);
    expect(await bootUnderRole('all')).toBe(1);
    expect(await bootUnderRole('web')).toBe(0);
  });
});

/**
 * The de-duplication that PR #2101 thought it had.
 *
 * pg-boss 10 makes de-duplication a QUEUE property: its unique index on
 * (name, singleton_key) is partial, `WHERE state='created' AND policy='short'`.
 * Under the default `standard` policy a send's singletonKey is stored and NEVER
 * enforced — `SyncOrchestrator.ts` documents the same trap, and
 * `select policy from pgboss.queue` on a live appliance returned `standard` for
 * all 32 queues while the "de-dupe" was supposedly in force.
 *
 * The original test asserted the KEY was on the send, against a mocked
 * `events.send`. That can never observe whether the queue enforces it, which is
 * exactly how an inert fix passed review. This asserts the queue DECLARATION,
 * which is the half that was missing.
 */
describe('ImportStageListener queue policy', () => {
  it('declares policy "short" on every per-kind stage queue, so singletonKey bites', () => {
    const perKind = Object.values(IMPORT_STAGE_QUEUE_BY_KIND);

    expect(perKind.length).toBeGreaterThan(0);

    for (const queue of perKind) {
      expect(EventListenerRegistry.getQueueOptions(queue)?.policy).toBe('short');
    }
  });

  it('leaves the legacy shared drain queue on the default policy', () => {
    // `short` is queue-wide and collapses KEYLESS sends together under
    // COALESCE(singleton_key,''). enqueueStage falls back to this queue without
    // a key when a stage's kind cannot be read, so it must not be `short`.
    expect(EventListenerRegistry.getQueueOptions(IMPORT_QUEUE)?.policy).toBeUndefined();
  });
});
