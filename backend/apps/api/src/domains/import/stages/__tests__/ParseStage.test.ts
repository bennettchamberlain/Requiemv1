import type { DataSourceRecognition } from '../../datasources/registry';
import type { StageRunContext } from '../../types';
import { ParseStage } from '../ParseStage';

/**
 * The central orchestration `run()` does: recognize, run each recognized
 * parser, catch a failing one and continue with the rest, and end the run
 * `partial` rather than `failed` when one did. The class's own doc comment
 * calls this out as the central design property ("One bad parser does not
 * fail the import") — a Takeout where one parser chokes still lands the other
 * five, rather than teaching people to re-upload 40GB because one parser met
 * a file it disliked. Only the two pure helpers this delegates to
 * (`dropGenericWhenSpecialised`, `rankDataSources`) had direct coverage before
 * this file; nothing drove `run()` itself.
 *
 * Recognition and staging are mocked at their module boundaries — which
 * source claims which tree is the parsers' own business (covered where they
 * are tested), and `StagedWriter`'s DB writes are covered by the staging
 * integration specs. What is under test here is `run()`'s own control flow.
 */

jest.mock('../../datasources/registry', () => ({
  dataSourcesRecognize: jest.fn(async () => []),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { dataSourcesRecognize } = require('../../datasources/registry') as { dataSourcesRecognize: jest.Mock };

jest.mock('../../staging/StagedWriter', () => ({
  StagedWriter: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { StagedWriter } = require('../../staging/StagedWriter') as { StagedWriter: jest.Mock };

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const emptyTotals = { items: 0, itemsDeduped: 0, entities: 0, entitiesGrown: 0, relationships: 0, drops: {} };

/** A recognized match whose importer either stages `items` rows or throws. */
function matchFor(name: string, opts: { throws?: string; items?: number } = {}): DataSourceRecognition {
  return {
    data_source: {
      name,
      title: name,
      icon: '',
      description: '',
      newFileImporter: () => ({
        recognize: async () => ({ confidence: 1 }),
        fileImport: async () => {
          if (opts.throws) {
            throw new Error(opts.throws);
          }
        },
      }),
    },
    recognition: { confidence: 1 },
  } as unknown as DataSourceRecognition;
}

function buildStage(totalsBySource: Record<string, typeof emptyTotals> = {}) {
  const updates: Array<{ sql: string; params: unknown[] }> = [];

  const dataSource = {
    manager: {},
    query: jest.fn(async (sql: string, params: unknown[]) => {
      updates.push({ sql, params });

      return [];
    }),
  };

  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn() };

  // One StagedWriter instance per parseOne() call. The constructor's second
  // argument carries { dataSource: name }, which is how each instance knows
  // which source's totals to answer with.
  StagedWriter.mockImplementation((_manager: unknown, opts: { dataSource: string }) => ({
    push: jest.fn(),
    settled: jest.fn(async () => undefined),
    totals: totalsBySource[opts.dataSource] ?? emptyTotals,
  }));

  return { stage: new ParseStage(dataSource as never, logger as never), dataSource, updates, logger };
}

function contextFor(): StageRunContext {
  return {
    runId: RUN_ID,
    userId: USER_ID,
    stageId: '33333333-3333-4333-8333-333333333333',
    scratchDir: '/var/tmp/ci-import/test-run',
    progress: jest.fn(async () => undefined),
  };
}

beforeEach(() => {
  dataSourcesRecognize.mockReset();
  dataSourcesRecognize.mockResolvedValue([]);
  StagedWriter.mockReset();
});

describe('ParseStage.run', () => {
  it('reports an honest "nothing recognized" outcome rather than an error', async () => {
    const { stage } = buildStage();

    const outcome = await stage.run(contextFor());

    expect(outcome).toMatchObject({ processed: 0, total: 0, partial: true });
    expect(outcome.detail).toMatchObject({ recognized: [] });
  });

  it('runs every recognized source and reports a full success', async () => {
    dataSourcesRecognize.mockResolvedValue([matchFor('gmail'), matchFor('calendar')]);
    const { stage, dataSource } = buildStage({
      gmail: { ...emptyTotals, items: 5 },
      calendar: { ...emptyTotals, items: 2 },
    });

    const outcome = await stage.run(contextFor());

    expect(outcome.partial).toBe(false);
    expect(outcome.processed).toBe(7); // 5 + 2, items + entities per source
    expect(outcome.detail.failures).toEqual([]);
    expect(outcome.detail.recognized).toEqual(['gmail', 'calendar']);

    // The run gets stamped with the ranked source list, via rankDataSources.
    const stampCall = dataSource.query.mock.calls.find((call: unknown[]) =>
      String(call[0]).includes('UPDATE ci_import.import_runs'),
    );
    expect(stampCall![1]).toEqual([RUN_ID, ['gmail', 'calendar']]);
  });

  it('catches one parser throwing, records it, and still runs the rest', async () => {
    // The central design property this stage exists for: a Takeout where one
    // of three parsers chokes lands the other two rather than aborting.
    dataSourcesRecognize.mockResolvedValue([
      matchFor('gmail'),
      matchFor('broken_source', { throws: 'unexpected end of archive' }),
      matchFor('calendar'),
    ]);
    const { stage } = buildStage({
      gmail: { ...emptyTotals, items: 3 },
      calendar: { ...emptyTotals, items: 1 },
    });

    const outcome = await stage.run(contextFor());

    // partial — terminal and success-ish — never failed. A thrown parser must
    // not abort the sources that had not run yet.
    expect(outcome.partial).toBe(true);
    expect(outcome.processed).toBe(4); // gmail's 3 + calendar's 1; broken_source staged nothing
    expect(outcome.detail.failures).toEqual([
      { dataSource: 'broken_source', error: 'unexpected end of archive' },
    ]);
    // Still recognized — the match happened; only the import itself failed.
    expect(outcome.detail.recognized).toEqual(['gmail', 'broken_source', 'calendar']);
    // The two sources that DID work are still in the per-source detail.
    expect(outcome.detail.sources).toEqual([
      { dataSource: 'gmail', ...emptyTotals, items: 3 },
      { dataSource: 'calendar', ...emptyTotals, items: 1 },
    ]);
  });

  it('ends partial, not failed, even when every recognized source throws', async () => {
    // A run that staged nothing at all is still a completed (if useless) parse
    // attempt, not a hard failure — ImportRunService.pulledRecords is what
    // downstream code asks to learn whether anything landed.
    dataSourcesRecognize.mockResolvedValue([
      matchFor('a', { throws: 'boom a' }),
      matchFor('b', { throws: 'boom b' }),
    ]);
    const { stage } = buildStage();

    const outcome = await stage.run(contextFor());

    expect(outcome.partial).toBe(true);
    expect(outcome.processed).toBe(0);
    expect((outcome.detail.failures as unknown[]).length).toBe(2);
  });

  it('fails one source cleanly when its recognized match has no importer at all', async () => {
    const stubOnly: DataSourceRecognition = {
      data_source: { name: 'not_yet_implemented', title: 'Stub', icon: '', description: '', stub: true },
      recognition: { confidence: 1 },
    } as unknown as DataSourceRecognition;

    dataSourcesRecognize.mockResolvedValue([matchFor('gmail'), stubOnly]);
    const { stage } = buildStage({ gmail: { ...emptyTotals, items: 1 } });

    const outcome = await stage.run(contextFor());

    expect(outcome.partial).toBe(true);
    expect(outcome.detail.failures).toEqual([
      {
        dataSource: 'not_yet_implemented',
        error: 'not_yet_implemented recognized the tree but has no file importer',
      },
    ]);
    expect(outcome.processed).toBe(1);
  });
});
