/**
 * Sources is the merge of three routes — `/connect`, `/connections`, `/import` —
 * that answered one question badly. What is asserted here is the part a
 * refactor could quietly undo: that both paths are on screen at once, that the
 * empty state guides instead of reporting `Total Connections: 0`, and that the
 * import half stays hidden when the appliance has importing turned off.
 */
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { SourcesPage } from './SourcesPage';

const h = vi.hoisted(() => ({
  connections: 0,
  imports: 0,
  importEnabled: true,
}));

vi.mock('@/common/feature', async () => {
  const actual = await vi.importActual<typeof import('@/common/feature')>('@/common/feature');

  return {
    ...actual,
    useFeatures: () => ({
      isFeatureEnabled: (flag: string) => (flag === 'import.page' ? h.importEnabled : true),
    }),
  };
});

vi.mock('./useSourceCounts', () => ({
  useSourceCounts: () => ({
    connections: h.connections,
    imports: h.imports,
    isFirstRun: h.connections === 0 && h.imports === 0,
    loading: false,
  }),
}));

// Both halves are real surfaces with their own network graphs. This page's job
// is which one is on screen, so they are stubbed down to a marker.
vi.mock('./ConnectPanel', () => ({ ConnectPanel: () => <div>connect panel</div> }));
vi.mock('@/pages/ImportPage/ImportPage', () => ({
  ImportSurface: ({ variant }: { variant?: string }) => <div>import surface: {variant ?? 'page'}</div>,
}));

beforeEach(() => {
  h.connections = 0;
  h.imports = 0;
  h.importEnabled = true;
});

function renderAt(route: string) {
  return renderWithProviders(<SourcesPage />, { route, path: '/sources/:half?' });
}

describe('SourcesPage', () => {
  it('offers both ways in from either half', async () => {
    renderAt('/sources/connect');

    // The switch is the point: someone who lands on the wrong half can see the
    // other one without going back.
    expect(await screen.findByRole('link', { name: /Connect a service/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Import an export/ })).toBeInTheDocument();
  });

  it('normalises /sources to the connect half', async () => {
    renderAt('/sources');

    await waitFor(() => expect(screen.getByText('connect panel')).toBeInTheDocument());
  });

  it('hosts the same import surface /import did', async () => {
    renderAt('/sources/import');

    expect(await screen.findByText(/import surface: page/)).toBeInTheDocument();
  });

  // The breadcrumb, the rail entry and the tiles all already name this page;
  // a heading and a standfirst on top of them pushed the only actionable thing
  // on the screen below the fold.
  it('does not restate its own name above the tiles', async () => {
    renderAt('/sources/connect');

    await waitFor(() => expect(screen.getByText('connect panel')).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: 'Sources' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Everything Companion knows came from somewhere/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is feeding your memory yet/i)).not.toBeInTheDocument();
  });

  describe('when nothing has ever fed the appliance', () => {
    it('draws the distinction people actually get wrong', async () => {
      renderAt('/sources/connect');

      // Connecting is cheap and forward-looking; an export is slow and
      // backward-looking. Someone choosing between them needs both halves of
      // that, not two equally-weighted buttons.
      expect(await screen.findByText(/About a minute, once\./)).toBeInTheDocument();
      expect(screen.getByText(/wait hours or days/i)).toBeInTheDocument();
      expect(screen.getByText(/Your whole history/i)).toBeInTheDocument();
    });

    it('gives each path its own call to action', async () => {
      renderAt('/sources/connect');

      expect(await screen.findByText('Browse services')).toBeInTheDocument();
      expect(screen.getByText('Start an import')).toBeInTheDocument();
    });
  });

  describe('once something is flowing', () => {
    it('drops the first-run guidance and reports counts instead', async () => {
      h.connections = 3;
      h.imports = 2;

      renderAt('/sources/connect');

      await waitFor(() => expect(screen.getByText('3 connected')).toBeInTheDocument());
      expect(screen.getByText('2 imports')).toBeInTheDocument();
      expect(screen.queryByText(/About a minute, once\./)).not.toBeInTheDocument();
      expect(screen.queryByText('Browse services')).not.toBeInTheDocument();
    });

    it('counts a single import in the singular', async () => {
      h.connections = 1;
      h.imports = 1;

      renderAt('/sources/connect');

      await waitFor(() => expect(screen.getByText('1 import')).toBeInTheDocument());
    });
  });

  describe('with importing turned off', () => {
    beforeEach(() => {
      h.importEnabled = false;
    });

    it('does not offer a path that leads nowhere', async () => {
      renderAt('/sources/connect');

      await waitFor(() => expect(screen.getByText('connect panel')).toBeInTheDocument());
      expect(screen.queryByRole('link', { name: /Import an export/ })).not.toBeInTheDocument();
    });

    it('lands /sources/import on the connect half rather than an empty page', async () => {
      // The import surface is not registered when the flag is off, so a stale
      // link or bookmark has to resolve to something real.
      renderAt('/sources/import');

      await waitFor(() => expect(screen.getByText('connect panel')).toBeInTheDocument());
      expect(screen.queryByText(/import surface/)).not.toBeInTheDocument();
    });
  });
});
