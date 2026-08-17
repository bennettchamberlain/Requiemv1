import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { JobsPage } from './JobsPage';
import type { JobsDashboardResponse } from './useJobsDashboard';

/**
 * The Jobs dashboard had no tests at all, and the things that were wrong with it
 * were all things a screenshot would not catch: the numbers counted the wrong
 * rows, a column showed the wrong jobs, and the single most useful field on the
 * wire was never rendered.
 *
 * These drive the page through the hook's return value rather than the network,
 * because what is under test is what the page DOES with a dashboard payload.
 */

const dashboardState = {
  data: null as JobsDashboardResponse | null,
  loading: false,
  error: null as string | null,
  staleSince: null as Date | null,
  updatedAt: null as Date | null,
  refresh: vi.fn(),
};

vi.mock('./useJobsDashboard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useJobsDashboard')>();

  return { ...actual, useJobsDashboard: () => dashboardState };
});

// Recharts measures its container, which jsdom reports as 0x0; the charts are
// not what these tests are about.
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();

  return { ...actual, PieChart: () => null, Pie: () => null, Cell: () => null };
});

function job(overrides: Partial<JobsDashboardResponse['jobs'][number]> = {}) {
  return {
    id: 'job-1',
    queue: 'search-index',
    state: 'created',
    priority: 0,
    retryLimit: 3,
    retryCount: 0,
    retryDelay: 10,
    retryBackoff: true,
    createdOn: '2026-08-17T00:00:00.000Z',
    startAfter: '2026-08-17T00:00:00.000Z',
    // The API projects the payload down to these — it does not ship `data` or
    // `output`, because job payloads are user content and this endpoint has no
    // owner predicate.
    event: 'note.created',
    workType: null,
    payloadBytes: 42,
    failure: null,
    ...overrides,
  } as JobsDashboardResponse['jobs'][number];
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

function render(response: JobsDashboardResponse, extra: Partial<typeof dashboardState> = {}) {
  Object.assign(dashboardState, {
    data: response,
    loading: false,
    error: null,
    staleSince: null,
    updatedAt: new Date('2026-08-17T00:05:00.000Z'),
    ...extra,
  });

  return renderWithProviders(<JobsPage />);
}

/** The card that owns a named column, so assertions can scope to just that column. */
function column(title: string): HTMLElement {
  const heading = screen.getByText(title);
  const card = heading.closest('div[data-slot="card"]') ?? heading.parentElement;

  if (!(card instanceof HTMLElement)) {
    throw new Error(`No column card found for "${title}"`);
  }

  return card;
}

describe('JobsPage summary', () => {
  it('reports pending and dead-lettered as separate figures', () => {
    render(dashboard());

    // The same 1,191 jobs used to be counted under BOTH Pending and Failed,
    // because pg-boss parks a dead-lettered job in state `created`.
    expect(screen.getByText('Pending').parentElement).toHaveTextContent('12,716');
    expect(screen.getByText('Dead-lettered').parentElement).toHaveTextContent('1,191');
    expect(screen.getByText('Retrying').parentElement).toHaveTextContent('3');
  });

  it('shows every job state, including the two that were previously unreported', () => {
    render(dashboard());

    // `retry` and `cancelled` were absent from the tiles, so a queue that was
    // entirely in retry read as idle.
    for (const label of ['Pending', 'Running', 'Retrying', 'Completed', 'Failed', 'Dead-lettered']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('says when the displayed data was last fetched', () => {
    render(dashboard());

    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
  });
});

describe('JobsPage layout', () => {
  it('lays the five columns out side by side', () => {
    const { container } = render(dashboard());

    // Widened from four when Failures was split out of Active Jobs; asserted
    // because a stale column count silently overflows the grid.
    expect(container.querySelector('.xl\\:grid-cols-5')).not.toBeNull();

    for (const title of ['Active Jobs', 'Failures', 'Completed Jobs', 'Schedules', 'Queues']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });
});

describe('JobsPage failure reporting', () => {
  /**
   * The whole point of the page for an operator. `output` was fetched, typed and
   * shipped to the browser, then discarded — so "Failed: 1,191" was the end of
   * the story. On the appliance this was written against, 628 of those failures
   * shared one cause.
   */
  it('renders the failure message a failed job carries in its output', () => {
    render(
      dashboard({
        jobs: [
          job({
            id: 'failed-1',
            queue: 'file-preview-generation',
            state: 'failed',
            retryCount: 3,
            event: 'file.uploaded',
            failure: {
              message: 'Cannot find ffmpeg',
              stack: 'Error: Cannot find ffmpeg\n    at FfmpegCommand.proto._getFfmpegPath',
              failedAt: '2026-08-17T09:21:10.289Z',
            },
          }),
        ],
      }),
    );

    expect(screen.getByText('Cannot find ffmpeg')).toBeInTheDocument();
    expect(screen.getByText(/at FfmpegCommand\.proto\._getFfmpegPath/)).toBeInTheDocument();
  });

  it('shows no failure block for a job that did not fail', () => {
    render(dashboard({ jobs: [job()] }));

    expect(screen.queryByText('Cannot find ffmpeg')).not.toBeInTheDocument();
  });

  it('shows no failure block when the server projected no failure', () => {
    // `output` also holds deliberate success payloads from deferred completions,
    // so the server returns null rather than something that renders as
    // "[object Object]" at an operator.
    render(dashboard({ jobs: [job({ state: 'failed', failure: null })] }));

    expect(screen.queryByText(/object Object/)).not.toBeInTheDocument();
  });
});

describe('JobsPage job columns', () => {
  it('keeps failed jobs out of Active Jobs and lists them under Failures', () => {
    render(
      dashboard({
        jobs: [
          job({ id: 'live-1', state: 'created', event: 'note.created' }),
          job({ id: 'dead-1', state: 'failed', event: 'file.uploaded' }),
        ],
      }),
    );

    // "Jobs waiting to run or currently executing" used to be `state !==
    // 'completed'`, so a permanently failed job read as queued work.
    const active = within(column('Active Jobs'));

    expect(active.getByText('note.created')).toBeInTheDocument();
    expect(active.queryByText('file.uploaded')).not.toBeInTheDocument();

    expect(within(column('Failures')).getByText('file.uploaded')).toBeInTheDocument();
  });

  it('treats dead-letter queue entries as failures even though their state is created', () => {
    render(
      dashboard({
        jobs: [job({ id: 'dl-1', queue: 'dead-letter', state: 'created', event: 'file.uploaded' })],
      }),
    );

    expect(within(column('Active Jobs')).queryByText('file.uploaded')).not.toBeInTheDocument();
    expect(within(column('Failures')).getByText('file.uploaded')).toBeInTheDocument();
  });

  /**
   * The Schedules column used to render `pgboss.schedule`, which nothing writes —
   * so it was empty on every appliance while ~34 NestJS crons ran invisibly.
   */
  it('lists the recurring jobs registered with the scheduler', () => {
    render(
      dashboard({
        crons: [
          {
            name: 'PipelineTickCron.tick',
            cron: '0 */2 * * * *',
            timezone: null,
            running: true,
            nextRunAt: '2026-08-17T01:00:00.000Z',
            lastRunAt: '2026-08-17T00:00:00.000Z',
          },
        ],
      }),
    );

    const schedules = within(column('Schedules'));

    expect(schedules.getByText('PipelineTickCron.tick')).toBeInTheDocument();
    expect(schedules.getByText('0 */2 * * * *')).toBeInTheDocument();
  });
});

describe('JobsPage staleness', () => {
  it('says so when refreshes are failing behind still-displayed data', () => {
    render(dashboard(), {
      staleSince: new Date('2026-08-17T00:05:00.000Z'),
      error: 'Failed to fetch',
    });

    // Previously this failure was swallowed entirely: the page kept
    // auto-refreshing and kept showing frozen numbers with no indication.
    const status = screen.getByRole('status');

    expect(status).toHaveTextContent(/refreshes have been failing/i);
    expect(status).toHaveTextContent(/Failed to fetch/);
  });

  it('shows a plain error when the very first load fails', () => {
    Object.assign(dashboardState, { data: null, error: 'Network down', staleSince: null });

    renderWithProviders(<JobsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Network down');
  });
});
