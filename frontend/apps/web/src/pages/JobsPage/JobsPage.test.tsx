import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { JobsPage } from './JobsPage';
import type { JobHistoryResponse } from './useJobHistory';
import type { JobsDashboardResponse } from './useJobsDashboard';
import type { JobListItem, JobListResponse } from './useJobsList';

/**
 * The Jobs dashboard, rebuilt around one filterable table.
 *
 * These drive the page through its three hooks rather than the network, because
 * what is under test is what the page DOES with a payload — the arithmetic, the
 * filter wiring and the failure rendering. `useJobsList` is captured rather than
 * stubbed blind so a test can assert the filters the page ASKED for, which is
 * where the query-vs-client-filtering bug would hide.
 */

const dashboardState = {
  data: null as JobsDashboardResponse | null,
  loading: false,
  error: null as string | null,
  staleSince: null as Date | null,
  updatedAt: null as Date | null,
  refresh: vi.fn(),
};

const listState = {
  data: null as JobListResponse | null,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
};

const historyState = {
  data: null as JobHistoryResponse | null,
  loading: false,
  error: null as string | null,
  refresh: vi.fn(),
};

/** Filters the page handed the list hook on its most recent render. */
let lastFilters: Record<string, unknown> = {};
/** Window (hours) the page handed the history hook. */
let lastWindowHours = 0;

vi.mock('./useJobsDashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useJobsDashboard')>();

  return { ...actual, useJobsDashboard: () => dashboardState };
});

vi.mock('./useJobsList', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useJobsList')>();

  return {
    ...actual,
    useJobsList: (filters: Record<string, unknown>) => {
      lastFilters = filters;

      return listState;
    },
  };
});

vi.mock('./useJobHistory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useJobHistory')>();

  return {
    ...actual,
    useJobHistory: (hours: number) => {
      lastWindowHours = hours;

      return historyState;
    },
  };
});

// Recharts measures its container, which jsdom reports as 0x0.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();

  return {
    ...actual,
    AreaChart: () => null,
    BarChart: () => null,
    LineChart: () => null,
  };
});

function job(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 'job-1',
    queue: 'search-index',
    state: 'created',
    event: 'note.created',
    workType: null,
    label: 'note created',
    category: 'search',
    description: 'Index a new note for search',
    interactive: false,
    createdOn: '2026-08-17T00:00:00.000Z',
    startedOn: null,
    completedOn: null,
    durationMs: null,
    retryCount: 0,
    retryLimit: 3,
    payloadBytes: 120,
    failure: null,
    deadLettered: false,
    ...overrides,
  };
}

function list(overrides: Partial<JobListResponse> = {}): JobListResponse {
  return {
    items: [],
    total: 0,
    limit: 50,
    offset: 0,
    queues: ['search-index', 'image-description'],
    stateCounts: { created: 12716, failed: 821, 'dead-letter': 1191 },
    ...overrides,
  };
}

function dashboard(overrides: Partial<JobsDashboardResponse> = {}): JobsDashboardResponse {
  return {
    summary: {
      pending: 12716,
      active: 12,
      retry: 3,
      completed: 115135,
      failed: 1191,
      cancelled: 0,
      deadLettered: 1191,
      scheduled: 0,
    },
    archiveDistribution: [],
    activeDistribution: [],
    queueDistribution: [],
    smartRotationDistribution: [],
    jobs: [],
    archive: [],
    schedules: [],
    crons: [],
    queues: [],
    ...overrides,
  };
}

function render(options: {
  dashboard?: JobsDashboardResponse;
  list?: JobListResponse;
  history?: JobHistoryResponse;
  staleSince?: Date | null;
  error?: string | null;
} = {}) {
  Object.assign(dashboardState, {
    data: options.dashboard ?? dashboard(),
    loading: false,
    error: options.error ?? null,
    staleSince: options.staleSince ?? null,
    updatedAt: new Date('2026-08-17T00:05:00.000Z'),
  });

  Object.assign(listState, { data: options.list ?? list(), loading: false, error: null });
  Object.assign(historyState, { data: options.history ?? null, loading: false, error: null });

  return renderWithProviders(<JobsPage />);
}

describe('JobsPage summary', () => {
  /**
   * Several labels ("Failed", "Dead-lettered") appear both as a summary tile and
   * as a state tab, so assertions here scope to the tile that carries the count.
   */
  function tile(label: string): HTMLElement {
    const heading = screen
      .getAllByText(label)
      .find((node) => node.className.includes('uppercase') && node.tagName === 'P');

    const button = heading?.closest('button');

    if (!button) {
      throw new Error(`No summary tile for "${label}"`);
    }

    return button;
  }

  it('reports pending and dead-lettered as separate figures', () => {
    render();

    // The same 1,191 jobs used to be counted under BOTH Pending and Failed,
    // because pg-boss parks a dead-lettered job in state `created`.
    expect(tile('Pending')).toHaveTextContent('12,716');
    expect(tile('Dead-lettered')).toHaveTextContent('1,191');
    expect(tile('Retrying')).toHaveTextContent('3');
  });

  it('makes each tile a shortcut into the table', () => {
    render();

    fireEvent.click(tile('Failed'));

    // A number an operator cannot click is a number they have to go hunting for.
    expect(lastFilters).toMatchObject({ state: 'failed', offset: 0 });
  });
});

describe('JobsPage table', () => {
  it('renders the taxonomy label and the raw event name for each job', () => {
    render({
      list: list({
        items: [job({ label: 'Embed for semantic search', event: 'search.embed.entity' })],
        total: 1,
      }),
    });

    // "Embed for semantic search" is the point: `search.embed.entity` on
    // `search-index` says nothing about what the appliance is doing.
    expect(screen.getByText('Embed for semantic search')).toBeInTheDocument();
    expect(screen.getByText('search.embed.entity')).toBeInTheDocument();
  });

  it('shows a failure message inline and its stack when the row is expanded', () => {
    render({
      list: list({
        items: [
          job({
            state: 'failed',
            label: 'File uploaded',
            failure: {
              message: 'Cannot find ffmpeg',
              stack: 'Error: Cannot find ffmpeg\n    at FfmpegCommand',
              failedAt: '2026-08-17T09:21:10.289Z',
            },
          }),
        ],
        total: 1,
      }),
    });

    expect(screen.getByText('Cannot find ffmpeg')).toBeInTheDocument();
    // Collapsed by default — stacks are long and most jobs never fail.
    expect(screen.queryByText(/at FfmpegCommand/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Details for File uploaded/ }));

    expect(screen.getByText(/at FfmpegCommand/)).toBeInTheDocument();
  });

  it('asks the server for the filters rather than filtering in the browser', () => {
    render();

    fireEvent.change(screen.getByLabelText('Search jobs'), { target: { value: 'ffmpeg' } });
    expect(lastFilters).toMatchObject({ search: 'ffmpeg', offset: 0 });

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'llm' } });
    expect(lastFilters).toMatchObject({ category: 'llm', offset: 0 });

    fireEvent.change(screen.getByLabelText('Queue'), { target: { value: 'image-description' } });
    expect(lastFilters).toMatchObject({ queue: 'image-description' });
  });

  it('labels a dead-lettered row as such rather than as waiting work', () => {
    render({
      list: list({
        items: [job({ queue: 'dead-letter', state: 'created', deadLettered: true })],
        total: 1,
      }),
    });

    // Its state column says `created`; calling that "waiting" is the bug.
    expect(screen.getByText('dead-lettered')).toBeInTheDocument();
  });

  it('carries per-state counts on the tabs', () => {
    render();

    const tab = screen.getByRole('tab', { name: /Dead-lettered/ });

    expect(within(tab).getByText('1,191')).toBeInTheDocument();
  });

  it('pages through results without re-running the search', () => {
    render({ list: list({ items: [job()], total: 500 }) });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(lastFilters).toMatchObject({ offset: 50 });
  });
});

describe('JobsPage history', () => {
  it('defaults to a 24-hour window and lets it be changed', () => {
    render();

    expect(lastWindowHours).toBe(24);

    fireEvent.click(screen.getByRole('button', { name: '7d' }));

    expect(lastWindowHours).toBe(24 * 7);
  });

  it('explains an empty chart instead of drawing nothing', () => {
    render({ history: { points: [], queues: [], bucketMinutes: 5, windowHours: 24 } });

    expect(screen.getByText(/No history recorded yet/)).toBeInTheDocument();
  });
});

describe('JobsPage schedules', () => {
  it('lists the recurring jobs from the live scheduler registry', () => {
    render({
      dashboard: dashboard({
        crons: [
          {
            name: 'PipelineTickCron.tick',
            cron: '0 */2 * * * *',
            timezone: null,
            running: true,
            nextRunAt: '2026-08-17T01:00:00.000Z',
            lastRunAt: null,
          },
        ],
      }),
    });

    // `pgboss.schedule` is empty on every appliance — nothing calls
    // boss.schedule(). These come from Nest's registry instead.
    expect(screen.getByText('PipelineTickCron.tick')).toBeInTheDocument();
    expect(screen.getByText('0 */2 * * * *')).toBeInTheDocument();
  });
});

describe('JobsPage staleness', () => {
  it('says so when refreshes are failing behind still-displayed data', () => {
    render({ staleSince: new Date('2026-08-17T00:05:00.000Z'), error: 'Failed to fetch' });

    const status = screen.getByRole('status');

    expect(status).toHaveTextContent(/refreshes have been failing/i);
    expect(status).toHaveTextContent(/Failed to fetch/);
  });

  it('shows a plain error when the very first load fails', () => {
    Object.assign(dashboardState, { data: null, error: 'Network down', staleSince: null });
    Object.assign(listState, { data: null, loading: false, error: null });
    Object.assign(historyState, { data: null, loading: false, error: null });

    renderWithProviders(<JobsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
  });
});
