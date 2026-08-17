import { StagedWriter } from '../StagedWriter';

/**
 * A flush that rejects must fail its PARSE, not the worker process.
 *
 * `scheduleFlush` is driven from the synchronous `push`, so before this the
 * chain was left rejected until `settled()` awaited it — and a parse is one
 * long `await fileImport(...)`, so nothing observed the rejection in between.
 * Node's `unhandledRejection` handler then exited the worker, taking every
 * import on the appliance with it, and the staleness sweep re-queued the stage
 * into a crash loop. Reproduced live against the real class; the stack ended at
 * `StagedWriter.ts` with `EXIT=1`.
 */

const SCOPE = {
  userId: '33333333-3333-4333-8333-333333333333',
  runId: '11111111-1111-4111-8111-111111111111',
  dataSource: 'gpx',
};

/** A manager whose transaction always rejects — a CHECK violation, say. */
function failingManager(error: Error) {
  return {
    transaction: jest.fn(async () => {
      throw error;
    }),
  };
}

function graph() {
  return { item: { classification: 'location', metadata: {} } } as never;
}

describe('StagedWriter flush failure', () => {
  it('does not leave an unobserved rejection when a flush fails', async () => {
    const boom = new Error('new row violates check constraint "staged_items_latitude_check"');
    // Threshold 1 so the very first push schedules — and fails — a flush.
    const writer = new StagedWriter(failingManager(boom) as never, SCOPE, 1);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      writer.push(graph());

      // Let the microtask queue drain and a macrotask elapse — this is the
      // window in which the process-level handler used to fire.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    // And the error is not swallowed: it surfaces where the contract says.
    await expect(writer.settled()).rejects.toThrow('staged_items_latitude_check');
  });

  it('reports the FIRST failure, and stops writing after it', async () => {
    const boom = new Error('first failure');
    const manager = failingManager(boom);
    const writer = new StagedWriter(manager as never, SCOPE, 1);

    writer.push(graph());
    writer.push(graph());
    writer.push(graph());

    await expect(writer.settled()).rejects.toThrow('first failure');

    // Only the first batch was attempted: continuing would add rows to a run
    // that is about to be reported broken.
    expect(manager.transaction).toHaveBeenCalledTimes(1);
  });
});
