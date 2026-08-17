import type { RunDetail, StageSummary } from '../../controllers/ImportRunsController';
import { waitForRuns, WaitTimeoutError, TERMINAL_RUN_STATUSES } from '../wait';

import { harness } from './support/harness';

const detail = (status: string, percent: number, stages: Array<Partial<StageSummary>> = []): RunDetail => ({
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  label: null,
  source: 'cli',
  dataSources: [],
  status,
  percent,
  requestedStages: [],
  error: null,
  createdAt: new Date(0),
  startedAt: null,
  finishedAt: null,
  stages: stages as StageSummary[],
});

describe('waitForRuns', () => {
  it('treats partial as terminal — a half-parsed archive still imported something', () => {
    expect([...TERMINAL_RUN_STATUSES].sort()).toEqual(['cancelled', 'completed', 'failed', 'partial']);
  });

  it('polls until the run closes and returns its final state', async () => {
    const states = ['queued', 'running', 'completed'];
    const ctx = harness({ getRun: async () => detail(states.shift() ?? 'completed', 100) });

    const finished = await waitForRuns(ctx.client, ctx.term, ['run-1'], { sleep: async () => undefined });

    expect(finished).toHaveLength(1);
    expect(finished[0].status).toBe('completed');
  });

  it('prints only when something changed, so a log file stays readable', async () => {
    const states = ['running', 'running', 'running', 'completed'];
    const ctx = harness({ getRun: async () => detail(states.shift() ?? 'completed', 50) });

    await waitForRuns(ctx.client, ctx.term, ['run-1'], { sleep: async () => undefined });

    // Three identical polls collapse to one line; the close is the second.
    expect(ctx.term.lines).toHaveLength(2);
  });

  it('names the stage and its counters while one is running', async () => {
    const states = ['running', 'completed'];
    const ctx = harness({
      getRun: async () =>
        detail(states.shift() ?? 'completed', 30, [
          { seq: 0, kind: 'parse', status: 'running', phase: 'gmail', processed: 40, total: 100 },
        ]),
    });

    await waitForRuns(ctx.client, ctx.term, ['run-1'], { sleep: async () => undefined });

    expect(ctx.term.text()).toContain('parse/gmail 40/100');
  });

  it('costs nothing when the run is already finished', async () => {
    let polls = 0;
    const ctx = harness({
      getRun: async () => {
        polls += 1;

        return detail('completed', 100);
      },
    });

    await waitForRuns(ctx.client, ctx.term, ['run-1'], {
      sleep: async () => {
        throw new Error('must not sleep');
      },
    });

    expect(polls).toBe(1);
  });

  it('gives up on --timeout with an id to follow up on', async () => {
    let clock = 0;
    const ctx = harness({ getRun: async () => detail('running', 10) });

    await expect(
      waitForRuns(ctx.client, ctx.term, ['run-1'], {
        sleep: async () => {
          clock += 5000;
        },
        now: () => clock,
        timeoutMs: 1000,
      }),
    ).rejects.toBeInstanceOf(WaitTimeoutError);
  });

  it('stops following a run that disappears rather than spinning forever', async () => {
    const ctx = harness({
      getRun: async () => {
        throw new Error('404');
      },
    });

    await expect(
      waitForRuns(ctx.client, ctx.term, ['gone'], { sleep: async () => undefined }),
    ).resolves.toEqual([]);
  });

  it('prefixes lines with a run id when following more than one', async () => {
    const ctx = harness({ getRun: async (id: string) => ({ ...detail('completed', 100), id }) });

    await waitForRuns(ctx.client, ctx.term, ['aaaaaaaa-1', 'bbbbbbbb-2'], { sleep: async () => undefined });

    expect(ctx.term.text()).toContain('[aaaaaaaa]');
    expect(ctx.term.text()).toContain('[bbbbbbbb]');
  });
});
