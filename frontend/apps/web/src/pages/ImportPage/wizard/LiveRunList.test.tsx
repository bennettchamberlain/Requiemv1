import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ImportRun } from '../useImportApi';

import { LiveRunList } from './LiveRunList';

/**
 * The render-weight contract born from a real incident: ~140 Takeout runs ×
 * one full polling card each pegged the tab's renderer process. Finished runs
 * must collapse to a line; only unfinished ones may carry the full card.
 */

const runsPage = vi.hoisted(() => ({ value: [] as Partial<ImportRun>[] }));

vi.mock('../useImportApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../useImportApi')>();

  return {
    ...actual,
    // The shared poll is stubbed with a controlled answer: `useRunsProgress`
    // internally calls the real `useImportApi` (a module-local binding a mock
    // cannot intercept), which needs the whole auth provider tree. What THIS
    // spec owns is the render-weight split, not the polling.
    useRunsProgress: () =>
      new Map(runsPage.value.map((run) => [run.id as string, run as ImportRun])),
  };
});

vi.mock('./LiveRun', () => ({
  LiveRun: ({ runId }: { runId: string }) => <div>full card for {runId}</div>,
}));

function run(overrides: Partial<ImportRun> & { id: string }): Partial<ImportRun> {
  return { label: overrides.id, dataSources: [], status: 'completed', ...overrides };
}

describe('LiveRunList', () => {
  it('collapses finished runs to a line and keeps the full card for unfinished ones', async () => {
    runsPage.value = [
      run({ id: 'r-done', label: 'part-1.zip', status: 'completed', records: 1200 }),
      run({ id: 'r-going', label: 'part-2.zip', status: 'running' }),
    ];

    render(<LiveRunList runIds={['r-done', 'r-going']} />);

    // Finished: one-line row with its yield, NOT a full card.
    expect(await screen.findByText('part-1.zip')).toBeInTheDocument();
    expect(screen.getByText('1200 records')).toBeInTheDocument();
    expect(screen.queryByText('full card for r-done')).not.toBeInTheDocument();

    // Unfinished: the full card, exactly as before.
    expect(screen.getByText('full card for r-going')).toBeInTheDocument();
  });

  it('renders a failed run loudly, with its error on the line', async () => {
    runsPage.value = [run({ id: 'r-bad', label: 'part-3.zip', status: 'failed', error: 'unpack exploded' })];

    render(<LiveRunList runIds={['r-bad']} />);

    expect(await screen.findByText('part-3.zip')).toBeInTheDocument();
    expect(screen.getByText(/unpack exploded/)).toBeInTheDocument();
  });

  it('gives a run the list has not answered for the full card, optimistically', () => {
    runsPage.value = [];

    render(<LiveRunList runIds={['r-unknown']} />);

    expect(screen.getByText('full card for r-unknown')).toBeInTheDocument();
  });

  it('renders nothing for an empty id list', () => {
    const { container } = render(<LiveRunList runIds={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
