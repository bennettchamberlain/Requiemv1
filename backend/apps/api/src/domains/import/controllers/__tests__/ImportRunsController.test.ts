import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { RequestContext } from '@ci/common/context';

import { ImportRunsController } from '../ImportRunsController';

/**
 * The run surface a person watches while their export imports.
 *
 * What is worth pinning here is the shape the UI depends on and the guards that
 * stop a caller reaching past their own runs:
 *
 *  - a stage with no countable total reports `null`, not 0 — a 0/0 bar reads as
 *    a finished stage;
 *  - an unknown stage name is refused BEFORE the run starts, where the caller
 *    can still fix it, rather than failing mid-import;
 *  - only a failed or cancelled stage can be re-run, because re-running a
 *    completed one would redo work that already landed in ci.*;
 *  - another user's run is a 404, not someone else's data.
 */

const ctx = { userId: 'user-1' } as RequestContext;

const RUN = {
  id: 'run-1',
  label: 'Takeout.zip',
  source: 'wizard',
  dataSources: ['audible', 'amazon'],
  status: 'running',
  percent: 30,
  requestedStages: ['unpack', 'parse', 'push'],
  error: null,
  createdAt: new Date('2026-08-12T00:00:00Z'),
  startedAt: new Date('2026-08-12T00:01:00Z'),
  finishedAt: null,
};

const STAGES = [
  {
    id: 'stage-unpack',
    seq: 0,
    kind: 'unpack',
    status: 'completed',
    phase: 'expanded',
    processed: '1',
    total: '1',
    weight: 30,
    etaSeconds: null,
    durationMs: '1200',
    error: null,
    detail: {},
  },
  {
    id: 'stage-parse',
    seq: 1,
    kind: 'parse',
    status: 'running',
    phase: 'parsing gmail (1/2)',
    processed: '412',
    // A parse discovers its total, so until it does there is nothing to divide by.
    total: null,
    weight: 50,
    etaSeconds: null,
    durationMs: null,
    error: null,
    detail: { recognized: ['gmail', 'google_photos'] },
  },
];

function makeController(
  overrides: {
    detail?: { run: typeof RUN; stages: typeof STAGES } | null;
    cancel?: boolean;
    retry?: boolean;
  } = {},
) {
  const runs = {
    // Typed generically rather than with unused parameters: the assertions read
    // `mock.calls[0][1]`, which needs a two-argument signature to index.
    startRun: jest.fn<Promise<{ run: typeof RUN; stages: typeof STAGES }>, [unknown, { stages?: string[] }]>(
      async () => ({ run: RUN, stages: STAGES }),
    ),
    listRuns: jest.fn(async () => [RUN]),
    getRunDetail: jest.fn(async () =>
      overrides.detail === undefined ? { run: RUN, stages: STAGES } : overrides.detail,
    ),
    listUnpushed: jest.fn(async () => [{ run: RUN, pendingItems: 3, pendingEntities: 1 }]),
    startPush: jest.fn<
      Promise<Array<{ run: typeof RUN; stage: (typeof STAGES)[number] }>>,
      [unknown, { runIds?: readonly string[] }]
    >(async () => [{ run: RUN, stage: STAGES[0] }]),
    cancel: jest.fn(async () => overrides.cancel ?? true),
    retryStage: jest.fn(async () => overrides.retry ?? true),
  };

  const catalog = {
    list: jest.fn(() => [{ name: 'gmail', title: 'Gmail', stub: false }]),
    catalog: jest.fn(() => [
      { id: 'gmail', title: 'Gmail (Google Takeout)', importer: 'gmail', importerReady: true },
    ]),
    find: jest.fn((name: string) => (name === 'gmail' ? { name, title: 'Gmail' } : null)),
  };

  return { controller: new ImportRunsController(runs as never, catalog as never), runs, catalog };
}

describe('ImportRunsController.start', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts a run against a staged upload and returns its stage bar', async () => {
    const { controller, runs } = makeController();

    const detail = await controller.start(ctx, { dropId: 'drop-1' });

    expect(runs.startRun).toHaveBeenCalledWith(
      { userId: 'user-1' },
      expect.objectContaining({
        dropId: 'drop-1',
        source: 'api',
      }),
    );
    expect(detail.stages.map((stage) => stage.kind)).toEqual(['unpack', 'parse']);
  });

  it('requires a drop to import', async () => {
    const { controller } = makeController();

    await expect(controller.start(ctx, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an unknown stage name before the run starts', async () => {
    // A typo would otherwise create a stage no runner can execute, which fails
    // loudly but only after the import is under way.
    const { controller, runs } = makeController();

    await expect(controller.start(ctx, { dropId: 'drop-1', stages: ['unpack', 'unpakc'] })).rejects.toThrow(
      /unpakc/,
    );
    expect(runs.startRun).not.toHaveBeenCalled();
  });

  it('accepts a narrowed stage list, which is how "just unpack it" is expressed', async () => {
    const { controller, runs } = makeController();

    await controller.start(ctx, { dropId: 'drop-1', stages: ['unpack'] });

    expect(runs.startRun.mock.calls[0][1]).toMatchObject({ stages: ['unpack'] });
  });
});

describe('ImportRunsController.get', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports an uncountable stage total as null rather than zero', async () => {
    const { controller } = makeController();

    const detail = await controller.get(ctx, 'run-1');

    // 0/0 would render as a finished stage; null is what tells the UI to draw an
    // indeterminate bar.
    expect(detail.stages[1].total).toBeNull();
    // bigint columns arrive as strings and must not reach the client that way.
    expect(detail.stages[1].processed).toBe(412);
    expect(detail.stages[0].durationMs).toBe(1200);
  });

  it('carries the detected services through to the run list', async () => {
    // The summary is built field by field, so a column added to the run does not
    // reach the page on its own — and the list has nothing but the archive's
    // filename to name a run with otherwise.
    const { controller } = makeController();
    const [listed] = await controller.list(ctx);

    expect(listed.dataSources).toEqual(['audible', 'amazon']);
  });

  it('404s a run this user does not have', async () => {
    const { controller } = makeController({ detail: null });

    await expect(controller.get(ctx, 'someone-elses-run')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ImportRunsController.recognized', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports what the parse found, resolved against the catalog', async () => {
    const { controller } = makeController();

    const answer = await controller.recognized(ctx, 'run-1');

    // google_photos is not in this catalog double, so it drops out rather than
    // being returned as a bare name the UI cannot render.
    expect(answer.recognized.map((source) => source.name)).toEqual(['gmail']);
  });

  it('says pending while the parse is still running', async () => {
    // An empty list before the parse means UNKNOWN, not "nothing in your
    // archive" — a caller that cannot tell those apart shows the wrong thing.
    const { controller } = makeController();

    expect((await controller.recognized(ctx, 'run-1')).pending).toBe(true);
  });

  it('says settled once the parse has finished', async () => {
    const { controller } = makeController({
      detail: {
        run: RUN,
        stages: [{ ...STAGES[1], status: 'completed' }],
      },
    });

    expect((await controller.recognized(ctx, 'run-1')).pending).toBe(false);
  });
});

describe('ImportRunsController.cancel and retry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancels a run in flight', async () => {
    const { controller } = makeController();

    expect(await controller.cancel(ctx, 'run-1')).toEqual({ cancelled: true });
  });

  it('404s a run that is already finished', async () => {
    const { controller } = makeController({ cancel: false });

    await expect(controller.cancel(ctx, 'run-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('re-queues a failed stage', async () => {
    const { controller, runs } = makeController();

    expect(await controller.retryStage(ctx, 'run-1', 'stage-parse')).toEqual({ requeued: true });
    expect(runs.retryStage).toHaveBeenCalledWith({ userId: 'user-1' }, 'run-1', 'stage-parse');
  });

  it('refuses to re-run a stage that did not fail', async () => {
    // Re-running a completed stage would redo work already in ci.*.
    const { controller } = makeController({ retry: false });

    await expect(controller.retryStage(ctx, 'run-1', 'stage-unpack')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('ImportRunsController.listSources', () => {
  it('lists what this appliance can import', () => {
    const { controller } = makeController();

    expect(controller.listSources()).toEqual([{ name: 'gmail', title: 'Gmail', stub: false }]);
  });
});

describe('ImportRunsController.sourceCatalog', () => {
  it('serves the source-keyed projection verbatim', () => {
    // Order and content are the service's; re-shaping either here would undo
    // the curated tier-then-ecosystem ordering the wizard renders.
    const { controller, catalog } = makeController();

    expect(controller.sourceCatalog()).toBe(catalog.catalog.mock.results[0].value);
  });
});

describe('ImportRunsController.listUnpushed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps each eligible run to its summary plus the pending counts', async () => {
    const { controller } = makeController();

    const unpushed = await controller.listUnpushed(ctx);

    expect(unpushed).toHaveLength(1);
    expect(unpushed[0]).toMatchObject({
      id: 'run-1',
      status: 'running',
      pendingItems: 3,
      pendingEntities: 1,
    });
    // The same field-by-field mapper as every other run answer — a new column
    // does not reach the wire unless it joins toRunSummary.
    expect(unpushed[0].createdAt).toEqual(RUN.createdAt);
  });

  it('refuses an unauthenticated caller', async () => {
    const { controller, runs } = makeController();

    await expect(controller.listUnpushed({} as RequestContext)).rejects.toBeInstanceOf(BadRequestException);
    expect(runs.listUnpushed).not.toHaveBeenCalled();
  });
});

describe('ImportRunsController.startPush', () => {
  beforeEach(() => jest.clearAllMocks());

  it('pushes everything when no body is sent — the Sync button’s call', async () => {
    const { controller, runs } = makeController();

    const result = await controller.startPush(ctx, undefined);

    expect(runs.startPush).toHaveBeenCalledWith({ userId: 'user-1' }, { runIds: undefined });
    expect(result.runs.map((run) => run.id)).toEqual(['run-1']);
  });

  it('passes a run-id filter through', async () => {
    const { controller, runs } = makeController();
    const id = 'a81bc81b-dead-4e5d-abff-90865d1e13b1';

    await controller.startPush(ctx, { runIds: [id] });

    expect(runs.startPush.mock.calls[0][1]).toEqual({ runIds: [id] });
  });

  it('refuses a malformed run id before the service is called', async () => {
    // The service binds these to a ::uuid[] cast, where a typo becomes a
    // Postgres syntax error — a 500 wearing the wrong blame.
    const { controller, runs } = makeController();

    await expect(controller.startPush(ctx, { runIds: ['not-a-uuid'] })).rejects.toThrow(/not-a-uuid/);
    expect(runs.startPush).not.toHaveBeenCalled();
  });

  it('answers nothing-to-sync with an empty list, not an error', async () => {
    const { controller, runs } = makeController();

    runs.startPush.mockResolvedValueOnce([]);

    expect(await controller.startPush(ctx, undefined)).toEqual({ runs: [] });
  });
});

describe('ImportRunsController authentication', () => {
  it('refuses an unauthenticated caller rather than reading another user', async () => {
    const { controller, runs } = makeController();

    await expect(controller.list({} as RequestContext)).rejects.toBeInstanceOf(BadRequestException);
    expect(runs.listRuns).not.toHaveBeenCalled();
  });
});
