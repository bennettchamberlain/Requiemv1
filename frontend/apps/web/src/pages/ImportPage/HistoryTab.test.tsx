import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HistoryTab } from './HistoryTab';

/**
 * The behaviors that moved here from the old single-surface page, still pinned:
 * a reload mid-import reattaches to the live run, and closing an opened run
 * collapses it back into the grid instead of losing it.
 */
const LIVE_RUN = {
  id: 'run-live',
  label: 'Takeout.zip',
  source: 'wizard',
  dataSources: [],
  status: 'running',
  percent: 40,
  requestedStages: ['unpack', 'parse'],
  error: null,
  createdAt: '2026-08-13T00:00:00Z',
  startedAt: '2026-08-13T00:01:00Z',
  finishedAt: null,
  stages: [],
};

const FINISHED_RUN = {
  ...LIVE_RUN,
  id: 'run-done',
  label: 'Amazon.zip',
  status: 'completed',
  percent: 100,
  finishedAt: '2026-08-12T00:30:00Z',
};

const FAILED_RUN = {
  ...LIVE_RUN,
  id: 'run-failed',
  label: 'Broken.zip',
  status: 'failed',
  percent: 0,
  error: 'archive extraction failed',
  finishedAt: '2026-08-12T00:05:00Z',
};

const listRuns = vi.fn(async () => [LIVE_RUN, FINISHED_RUN, FAILED_RUN]);

// STABLE, like the real hook: the load effect depends on the whole api object,
// so a fresh one per render re-runs it forever — see useImportApi.test.tsx.
const API = {
  ready: true,
  listSources: async () => [],
  listRuns,
  getRun: async () => LIVE_RUN,
  cancelRun: vi.fn(),
  retryStage: vi.fn(),
};

vi.mock('./useImportApi', () => ({
  useImportApi: () => API,
  // The list said the run was live (which is what triggers the reattach); by
  // the time its detail arrives it has finished — the ordinary end of an
  // import someone left open. Close only renders on a finished run.
  useRunProgress: (runId: string | null) => ({
    run:
      runId == null
        ? null
        : { ...LIVE_RUN, status: 'completed', percent: 100, finishedAt: '2026-08-13T00:30:00Z' },
    error: null,
    refresh: vi.fn(),
  }),
}));

describe('HistoryTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says whether each earlier import worked', async () => {
    // The card carried a label, a date and its services — so a run that FAILED
    // looked exactly like one that imported, on the surface whose whole job is
    // telling you what happened to your archives.
    render(<HistoryTab />);

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getAllByText('Imported').length).toBeGreaterThan(0);
  });

  it('reattaches to the run that is still going, and closing it keeps it reachable', async () => {
    render(<HistoryTab />);

    // The live run's pipeline opened on its own — a reload mid-import must not
    // look like nothing is happening.
    await screen.findByRole('button', { name: /close/i });
    expect(screen.getByText('Amazon.zip')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /close/i }));

    // Collapsed into the grid, not gone: every finished run now offers View.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /view/i })).toHaveLength(3));
    expect(screen.getByText('Takeout.zip')).toBeInTheDocument();
  });
});
