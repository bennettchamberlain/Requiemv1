import type { RequestContext } from '@ci/common/context';

import { ImportListSourcesTool } from '../ImportListSourcesTool';
import { ImportRunStatusTool } from '../ImportRunStatusTool';

/**
 * The import domain's intents, as an agent sees them.
 *
 * What matters here is not the plumbing — it is what an assistant will say out
 * loud from these results. A tool that reports a partial import as a failure
 * sends someone back to redo an hour of exporting for nothing, and a tool that
 * reports an async import as finished tells them their data is there when it is
 * not.
 */

const ctx = { userId: 'user-1' } as RequestContext;

function makeLogger() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
}

describe('ImportListSourcesTool', () => {
  const catalog = {
    list: jest.fn(() => [
      {
        name: 'gmail',
        title: 'Gmail',
        description: 'Mail as mbox',
        icon: 'gmail.svg',
        stub: false,
        supportsFiles: true,
        supportsApi: false,
        guide: { title: 'Gmail', steps: ['Open Takeout'] },
      },
      {
        name: 'strava',
        title: 'Strava',
        description: 'Activities',
        icon: 'strava.svg',
        stub: true,
        supportsFiles: true,
        supportsApi: false,
        guide: null,
      },
    ]),
  };

  const tool = new ImportListSourcesTool(catalog as never, makeLogger() as never);

  beforeEach(() => jest.clearAllMocks());

  it('lists what can be imported, marking what is not implemented yet', async () => {
    const result = await tool.execute(ctx, {});
    const data = result.data as { total: number; sources: Array<{ name: string; implemented: boolean }> };

    expect(data.total).toBe(2);
    // Listed rather than hidden: "we know this format and have not finished it"
    // is a different answer from silence, which reads as unsupported.
    expect(data.sources.find((source) => source.name === 'strava')?.implemented).toBe(false);
  });

  it('filters to what was asked about', async () => {
    const result = await tool.execute(ctx, { query: 'mail' });
    const data = result.data as { sources: Array<{ name: string }> };

    expect(data.sources.map((source) => source.name)).toEqual(['gmail']);
  });

  it('omits the guides unless asked, because they are paragraphs', async () => {
    const withoutGuides = (await tool.execute(ctx, {})).data as {
      sources: Array<Record<string, unknown>>;
    };

    expect(withoutGuides.sources[0]).not.toHaveProperty('guide');

    const withGuides = (await tool.execute(ctx, { includeGuide: true })).data as {
      sources: Array<{ guide: unknown }>;
    };

    expect(withGuides.sources[0].guide).toBeTruthy();
  });
});

describe('ImportRunStatusTool', () => {
  function makeTool(detail: unknown, recent: unknown[] = []) {
    const runs = {
      getRunDetail: jest.fn(async () => detail),
      listRuns: jest.fn(async () => recent),
    };

    return { tool: new ImportRunStatusTool(runs as never, makeLogger() as never), runs };
  }

  it('describes a partial run as a success with gaps', async () => {
    // The sentence an assistant reads out. "Failed" here is what makes someone
    // re-export and re-upload a 40GB archive over one file.
    const { tool } = makeTool({
      run: { id: 'run-1', label: 'Takeout', status: 'partial', percent: 100, finishedAt: new Date(), error: null },
      stages: [],
    });

    const data = (await tool.execute(ctx, { runId: 'run-1' })).data as { summary: string };

    expect(data.summary).toMatch(/some of the archive was skipped/i);
    expect(data.summary).not.toMatch(/fail/i);
  });

  it('reports an uncountable stage total as null, not zero', async () => {
    const { tool } = makeTool({
      run: { id: 'run-1', label: null, status: 'running', percent: 40, finishedAt: null, error: null },
      stages: [
        { kind: 'parse', status: 'running', phase: 'parsing gmail', processed: '412', total: null, error: null, detail: {} },
      ],
    });

    const data = (await tool.execute(ctx, { runId: 'run-1' })).data as {
      stages: Array<{ processed: number; total: number | null }>;
    };

    expect(data.stages[0].total).toBeNull();
    // bigint columns arrive as strings and must not reach an agent that way.
    expect(data.stages[0].processed).toBe(412);
  });

  it('falls back to recent runs when no id is given', async () => {
    const { tool } = makeTool(null, [
      { id: 'run-9', label: 'Takeout', status: 'running', percent: 12, finishedAt: null },
    ]);

    const data = (await tool.execute(ctx, {})).data as { runs: Array<{ runId: string; finished: boolean }> };

    expect(data.runs).toEqual([
      expect.objectContaining({ runId: 'run-9', finished: false }),
    ]);
  });

  it("says plainly when a run is not this user's", async () => {
    const { tool } = makeTool(null);

    const data = (await tool.execute(ctx, { runId: 'someone-elses' })).data as { found: boolean };

    expect(data.found).toBe(false);
  });
});
