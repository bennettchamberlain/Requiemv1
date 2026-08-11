import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GraphLink, GraphNode } from '@/api/useGraphOverview';

import { GraphTabPanel } from './GraphExplorerModal';

/**
 * The webbed-feet spike's interaction contract, end to end over mocked graph APIs:
 * select a node → info dialog; Focus → /api/graph/node subgraph with a return control;
 * select a link → connection-thread dialog; background click → everything resets.
 */

const node = (id: string, name: string): GraphNode => ({
  id,
  entity_id: id,
  entity_type: 'PersonType',
  name,
  description: `${name} description`,
  properties: {},
});

const link = (id: string, source: string, target: string, strength = 0.8): GraphLink => ({
  id,
  relationship_id: id,
  source,
  target,
  relationship_type: 'KNOWS_WELL',
  strength,
  properties: { since: '2019' },
});

const OVERVIEW = {
  nodes: [
    node('user-1', 'Owner Person'),
    node('friend-1', 'Frida Friend'),
    node('friend-2', 'Colm Colleague'),
  ],
  links: [link('rel-1', 'user-1', 'friend-1'), link('rel-2', 'friend-1', 'friend-2')],
};

// Frida's focus fetch: Dora is her own connection (1 hop); Rex hangs off Dora (2 hops), which the
// focus view keeps on screen as a receding context dot rather than a full member of her graph.
const FOCUS_SUBGRAPH = {
  nodes: [node('friend-1', 'Frida Friend'), node('distant-1', 'Dora Distant'), node('ring-1', 'Rex Ring')],
  links: [link('rel-3', 'friend-1', 'distant-1'), link('rel-4', 'distant-1', 'ring-1')],
};

const useNodeGraphServiceMock = vi.fn();
const setActiveEntityMock = vi.fn();

vi.mock('@/hooks', () => ({
  useAuth: () => [{ authToken: 'test-token' }],
}));

vi.mock('@/pages/MemoryPage/useEntityService', () => ({
  useEntityService: () => [{}, { setActiveEntity: setActiveEntityMock }],
}));

vi.mock('@/pages/MemoryPage/Components', () => ({
  Empty: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('@/components/SearchBox/useDropdown', () => ({
  AVAILABLE_ENTITY_TYPES: ['Person', 'Place'],
}));

vi.mock('@/api/useGraphOverview', () => ({
  useGraphOverview: () => ({
    loading: false,
    error: null,
    subgraph: OVERVIEW,
    userEntityId: 'user-1',
    quickStats: null,
    currentUser: null,
    filterMatchedEntityIds: null,
    filterScope: { tags: false, events: false },
  }),
}));

vi.mock('@/api/useNodeGraphService', () => ({
  useNodeGraphService: (props: { entityId?: string; skip?: boolean }) => useNodeGraphServiceMock(props),
}));

// The 3D renderer needs WebGL, which jsdom does not have. The stub records the graph it was
// handed so the toggle tests can assert the same data flows to either renderer.
vi.mock('./GraphCanvas3D', () => ({
  default: ({ nodes, links }: { nodes: GraphNode[]; links: GraphLink[] }) => (
    <div data-testid="graph-canvas-3d" data-node-count={nodes.length} data-link-count={links.length} />
  ),
}));

function renderShell() {
  return render(
    <MemoryRouter>
      <GraphTabPanel variant="desktop" />
    </MemoryRouter>,
  );
}

async function nodeGroup(name: string) {
  await waitFor(() => {
    expect(screen.getAllByTestId('force-node').length).toBeGreaterThan(0);
  });

  const group = screen
    .getAllByTestId('force-node')
    .find((candidate) => candidate.querySelector('title')?.textContent?.startsWith(name));

  expect(group).toBeDefined();

  return group!;
}

describe('GraphTabPanel (webbed-feet spike)', () => {
  const realRequestAnimationFrame = globalThis.requestAnimationFrame;
  const realCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    // Same pacing trick as ForceGraph.test.tsx: run the rAF-driven simulation on the macrotask
    // queue so the layout settles inside the test budget.
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0)) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((handle: number) =>
      clearTimeout(handle)) as unknown as typeof cancelAnimationFrame;

    useNodeGraphServiceMock.mockImplementation(({ entityId, skip }) =>
      skip || !entityId
        ? { data: null, loading: false, error: null, refresh: vi.fn() }
        : { data: FOCUS_SUBGRAPH, loading: false, error: null, refresh: vi.fn() },
    );
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = realRequestAnimationFrame;
    globalThis.cancelAnimationFrame = realCancelAnimationFrame;
    useNodeGraphServiceMock.mockReset();
    setActiveEntityMock.mockReset();
    localStorage.removeItem('ci-graph-view-dimension');
  });

  it('renders the overview graph with its stats line', async () => {
    renderShell();

    await waitFor(() => {
      expect(screen.getAllByTestId('force-node')).toHaveLength(OVERVIEW.nodes.length);
    });

    expect(screen.getByText('3 entities · 2 connections')).toBeInTheDocument();
    expect(screen.queryByTestId('graph-back-to-overview')).not.toBeInTheDocument();
  });

  it('opens the entity info dialog on node selection', async () => {
    renderShell();

    fireEvent.click(await nodeGroup('Frida Friend'));

    const dialog = await screen.findByTestId('entity-info-dialog');

    expect(dialog).toHaveTextContent('Frida Friend');
    expect(dialog).toHaveTextContent('Frida Friend description');
    // Both of Frida's relationships are listed as connections.
    expect(dialog).toHaveTextContent('Owner Person');
    expect(dialog).toHaveTextContent('Colm Colleague');
  });

  it('hands off to the shared entity details sheet from the dialog', async () => {
    renderShell();

    fireEvent.click(await nodeGroup('Frida Friend'));
    fireEvent.click(await screen.findByRole('button', { name: /details/i }));

    expect(setActiveEntityMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'friend-1', name: 'Frida Friend' }),
    );
  });

  it('enters focus mode from the dialog and returns to the overview', async () => {
    renderShell();

    fireEvent.click(await nodeGroup('Frida Friend'));
    fireEvent.click(await screen.findByRole('button', { name: /focus/i }));

    // Focus mode swaps in the /api/graph/node subgraph and shows the return control.
    await waitFor(() => {
      expect(useNodeGraphServiceMock).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: 'friend-1', skip: false }),
      );
      expect(screen.getByTestId('graph-back-to-overview')).toBeInTheDocument();
    });

    await nodeGroup('Dora Distant');
    expect(screen.getByText('3 entities · 2 connections')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('graph-back-to-overview'));

    await waitFor(() => {
      expect(screen.queryByTestId('graph-back-to-overview')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('force-node')).toHaveLength(OVERVIEW.nodes.length);
    });
  });

  it('draws the neighbourhood beyond the focused entity as unlabelled context dots', async () => {
    renderShell();

    fireEvent.click(await nodeGroup('Frida Friend'));
    fireEvent.click(await screen.findByRole('button', { name: /focus/i }));

    // Dora is Frida's own connection: full weight, named. Rex is two hops out: a context dot —
    // still on screen and still clickable, but faded, smaller and unlabelled.
    const own = await nodeGroup('Dora Distant');
    const ring = await nodeGroup('Rex Ring');

    expect(own).not.toHaveAttribute('data-context');
    expect(ring).toHaveAttribute('data-context', 'true');
    expect(ring.querySelector('text')?.textContent ?? '').toBe('');
    expect(Number.parseFloat(ring.getAttribute('opacity') ?? '1')).toBeLessThan(1);
  });

  it('opens the connection-thread dialog on link selection', async () => {
    renderShell();

    await waitFor(() => {
      expect(screen.getAllByTestId('force-link').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByTestId('force-link')[0]);

    const dialog = await screen.findByTestId('connection-thread-dialog');

    expect(dialog).toHaveTextContent('Knows Well');
    expect(dialog).toHaveTextContent('80%');
    expect(dialog).toHaveTextContent('since');

    // The graph marks the selected thread.
    expect(
      screen.getAllByTestId('force-link').filter((group) => group.getAttribute('data-selected') === 'true'),
    ).toHaveLength(1);
  });

  it('switches to the 3D renderer and back, remembering the choice', async () => {
    renderShell();

    // 2D SVG by default; no 3D canvas mounted (nor its three.js bundle loaded). The toggle is a
    // single button labelled with the dimension it switches TO.
    await waitFor(() => {
      expect(screen.getAllByTestId('force-node')).toHaveLength(OVERVIEW.nodes.length);
    });
    expect(screen.queryByTestId('graph-canvas-3d')).not.toBeInTheDocument();

    const toggle = screen.getByTestId('graph-dimension-toggle');

    expect(toggle).toHaveTextContent('3D');

    fireEvent.click(toggle);

    // Same display graph, different renderer; the toggle now offers the way back.
    const canvas3d = await screen.findByTestId('graph-canvas-3d');

    expect(canvas3d).toHaveAttribute('data-node-count', String(OVERVIEW.nodes.length));
    expect(canvas3d).toHaveAttribute('data-link-count', String(OVERVIEW.links.length));
    expect(screen.queryAllByTestId('force-node')).toHaveLength(0);
    expect(localStorage.getItem('ci-graph-view-dimension')).toBe('3d');
    expect(toggle).toHaveTextContent('2D');

    // The shell chrome — stats line and legend — stays up over either renderer.
    expect(screen.getByText('3 entities · 2 connections')).toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.getAllByTestId('force-node')).toHaveLength(OVERVIEW.nodes.length);
    });
    expect(screen.queryByTestId('graph-canvas-3d')).not.toBeInTheDocument();
    expect(localStorage.getItem('ci-graph-view-dimension')).toBe('2d');
    expect(toggle).toHaveTextContent('3D');
  });

  it('clears dialogs on a background click', async () => {
    renderShell();

    fireEvent.click(await nodeGroup('Frida Friend'));
    await screen.findByTestId('entity-info-dialog');

    fireEvent.click(screen.getByRole('img', { name: 'Knowledge graph overview' }));

    await waitFor(() => {
      expect(screen.queryByTestId('entity-info-dialog')).not.toBeInTheDocument();
    });
  });
});
