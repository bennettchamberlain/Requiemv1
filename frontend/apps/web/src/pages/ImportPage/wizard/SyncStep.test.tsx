import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SyncStep } from './SyncStep';

/**
 * The Sync card's promises: it shows exactly what is waiting (including runs
 * from an earlier abandoned session — that is the point of server-side
 * eligibility), one button pushes it all, and "nothing waiting" is a rendered
 * state rather than an error.
 */

const UNPUSHED = [
  {
    id: 'run-1',
    label: 'spotify.zip',
    status: 'completed',
    pendingItems: 1200,
    pendingEntities: 40,
  },
  {
    id: 'run-2',
    label: 'Takeout.zip',
    status: 'partial',
    pendingItems: 9800,
    pendingEntities: 0,
  },
];

const listUnpushed = vi.fn(async () => UNPUSHED);
const startPush = vi.fn(async () => ({ runs: [{ id: 'run-1' }, { id: 'run-2' }] }));

const API = {
  ready: true,
  listUnpushed,
  startPush,
};

vi.mock('../useImportApi', () => ({
  useImportApi: () => API,
}));

vi.mock('./LiveRun', () => ({
  LiveRun: ({ runId }: { runId: string }) => <div>pipeline for {runId}</div>,
}));

describe('SyncStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUnpushed.mockResolvedValue(UNPUSHED);
  });

  it('totals what is staged across every unpushed run', async () => {
    render(<SyncStep onBackToExport={vi.fn()} />);

    await screen.findByText(/11,000/);

    // The sentence is split across <strong> nodes; assert the assembled text.
    const summary = screen.getByText(
      (_, element) => element?.tagName === 'P' && /staged across 2 imports/.test(element.textContent ?? ''),
    );

    expect(summary).toBeInTheDocument();
    expect(screen.getByText('spotify.zip')).toBeInTheDocument();
    expect(screen.getByText('Takeout.zip')).toBeInTheDocument();
  });

  it('one click pushes everything and shows each run’s pipeline', async () => {
    render(<SyncStep onBackToExport={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /sync to my memory/i }));

    await waitFor(() => expect(startPush).toHaveBeenCalledTimes(1));
    // No runIds filter: Sync means everything.
    expect(startPush).toHaveBeenCalledWith();

    expect(await screen.findByText('pipeline for run-1')).toBeInTheDocument();
    expect(screen.getByText('pipeline for run-2')).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    listUnpushed.mockResolvedValue([]);

    render(<SyncStep onBackToExport={vi.fn()} />);

    expect(await screen.findByText(/nothing is waiting to sync/i)).toBeInTheDocument();
  });
});
