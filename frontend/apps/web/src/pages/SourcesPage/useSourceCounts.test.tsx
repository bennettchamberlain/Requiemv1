import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET_CONNECTIONS } from '@/components/connect/ConnectedAccountsSection';
import { renderWithProviders } from '@/test/renderWithProviders';

import { useSourceCounts } from './useSourceCounts';

/**
 * `isFirstRun` is the switch between "here is how to get started" and "here
 * is what you already have" — showing the former to someone with a decade of
 * data is the failure this hook exists to prevent, so it stays false until
 * every one of its three sources (connections, imports, devices) has
 * genuinely reported in, not just until the first one does.
 */

const h = vi.hoisted(() => ({
  importEnabled: true,
  api: { ready: true, listRuns: vi.fn() } as { ready: boolean; listRuns: (limit?: number) => Promise<unknown[]> },
  devices: { devices: [] as unknown[], loading: false },
}));

vi.mock('@/common/feature', async () => {
  const actual = await vi.importActual<typeof import('@/common/feature')>('@/common/feature');

  return {
    ...actual,
    useFeatures: () => ({ isFeatureEnabled: (flag: string) => (flag === 'import.page' ? h.importEnabled : true) }),
  };
});

vi.mock('@/pages/ImportPage/useImportApi', () => ({
  useImportApi: () => h.api,
}));

vi.mock('./useDevices', () => ({
  useDevices: () => h.devices,
}));

function connectionsMock(totalCount: number) {
  return {
    request: { query: GET_CONNECTIONS },
    result: {
      data: {
        connections: {
          __typename: 'ConnectionConnection' as const,
          edges: [],
          pageInfo: {
            __typename: 'PageInfo' as const,
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
          },
          totalCount,
        },
      },
    },
  };
}

function CountsProbe() {
  const counts = useSourceCounts();
  const navigate = useNavigate();

  return (
    <div>
      <span data-testid="connections">{counts.connections}</span>
      <span data-testid="imports">{counts.imports}</span>
      <span data-testid="devices">{counts.devices}</span>
      <span data-testid="first-run">{String(counts.isFirstRun)}</span>
      <span data-testid="loading">{String(counts.loading)}</span>
      <button onClick={() => navigate('/sources/import')}>go to import</button>
    </div>
  );
}

beforeEach(() => {
  h.importEnabled = true;
  h.api = { ready: true, listRuns: vi.fn().mockResolvedValue([]) };
  h.devices = { devices: [], loading: false };
});

describe('useSourceCounts isFirstRun gating', () => {
  it('stays loading, and not first-run, until imports has resolved even once connections and devices are back', async () => {
    let releaseImports!: (runs: unknown[]) => void;

    h.api = {
      ready: true,
      listRuns: vi.fn(() => new Promise<unknown[]>((resolve) => (releaseImports = resolve))),
    };

    renderWithProviders(<CountsProbe />, {
      route: '/sources/connect',
      mocks: [connectionsMock(0)],
    });

    // Connections and devices both resolve to zero quickly, but imports is
    // still an unsettled promise — first-run must not fire on 2 of 3.
    await waitFor(() => expect(screen.getByTestId('connections')).toHaveTextContent('0'));
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('first-run')).toHaveTextContent('false');

    releaseImports([]);

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('first-run')).toHaveTextContent('true');
  });

  it('does not call first-run when any source has real data', async () => {
    h.api = { ready: true, listRuns: vi.fn().mockResolvedValue([]) };
    h.devices = { devices: [{ device_id: 'd1' }], loading: false };

    renderWithProviders(<CountsProbe />, {
      route: '/sources/connect',
      mocks: [connectionsMock(3)],
    });

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('connections')).toHaveTextContent('3');
    expect(screen.getByTestId('devices')).toHaveTextContent('1');
    expect(screen.getByTestId('first-run')).toHaveTextContent('false');
  });

  it('leaves imports at null — not zero — when the import API cannot be reached, keeping first-run false', async () => {
    h.api = { ready: true, listRuns: vi.fn().mockRejectedValue(new Error('offline')) };

    renderWithProviders(<CountsProbe />, {
      route: '/sources/connect',
      mocks: [connectionsMock(0)],
    });

    // Give the rejected listRuns promise a tick to settle.
    await waitFor(() => expect(h.api.listRuns).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Someone with a decade of unreachable-appliance imports must not be told
    // they have nothing — loading (not first-run) is what a broken API shows.
    expect(screen.getByTestId('imports')).toHaveTextContent('0'); // ?? 0 fallback for display
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
    expect(screen.getByTestId('first-run')).toHaveTextContent('false');
  });

  it('skips the imports fetch entirely, and counts zero, when the import feature is off', async () => {
    h.importEnabled = false;

    renderWithProviders(<CountsProbe />, {
      route: '/sources/connect',
      mocks: [connectionsMock(0)],
    });

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    expect(h.api.listRuns).not.toHaveBeenCalled();
    expect(screen.getByTestId('imports')).toHaveTextContent('0');
    expect(screen.getByTestId('first-run')).toHaveTextContent('true');
  });
});

describe('useSourceCounts pathname refetch', () => {
  it('re-asks the import API every time the route crosses to a different path', async () => {
    renderWithProviders(<CountsProbe />, {
      route: '/sources/connect',
      mocks: [connectionsMock(0), connectionsMock(0)],
    });

    await waitFor(() => expect(h.api.listRuns).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'go to import' }));

    // A run finished while looking at /connect must be reflected on
    // returning — the only way that happens is asking again on every
    // crossing, not just on first mount.
    await waitFor(() => expect(h.api.listRuns).toHaveBeenCalledTimes(2));
  });
});
