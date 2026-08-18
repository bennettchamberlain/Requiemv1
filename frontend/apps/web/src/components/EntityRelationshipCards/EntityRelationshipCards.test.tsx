import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Subgraph } from '@/api/useNodeGraphService';
import { renderWithProviders } from '@/test/renderWithProviders';

import { EntityRelationshipCards } from './EntityRelationshipCards';

const useNodeGraphServiceMock = vi.fn();

vi.mock('@/api/useNodeGraphService', () => ({
  useNodeGraphService: (props: unknown) => useNodeGraphServiceMock(props),
}));

const FOCUS_ID = 'user-1';

const SUBGRAPH: Subgraph = {
  nodes: [
    {
      id: FOCUS_ID,
      entity_id: FOCUS_ID,
      entity_type: 'person',
      name: 'Me',
      description: null,
      properties: {},
    },
    {
      id: 'friend-1',
      entity_id: 'friend-1',
      entity_type: 'person',
      name: 'Frida Friend',
      description: 'A friend from work',
      properties: {},
    },
  ],
  links: [
    {
      id: 'rel-1',
      relationship_id: 'rel-1',
      source: FOCUS_ID,
      target: 'friend-1',
      relationship_type: 'KNOWS',
      strength: 0.9,
      properties: {},
    },
  ],
};

function renderCards(entityId = FOCUS_ID) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<EntityRelationshipCards entityId={entityId} />} />
      <Route path="/people/:id" element={<div>Person detail page</div>} />
    </Routes>,
  );
}

describe('EntityRelationshipCards', () => {
  beforeEach(() => {
    useNodeGraphServiceMock.mockReset();
    useNodeGraphServiceMock.mockReturnValue({ data: SUBGRAPH, loading: false, error: null });
  });

  it('renders a card for the related entity, naming the relationship and the neighbor', () => {
    renderCards();

    expect(screen.getByText('Frida Friend')).toBeInTheDocument();
    expect(screen.getByText('Knows')).toBeInTheDocument();
  });

  it('navigates to the related entity route when a card is clicked', async () => {
    renderCards();

    // The whole card is the <Link> — clicking the neighbor's name should route to their page.
    fireEvent.click(screen.getByText('Frida Friend'));

    expect(await screen.findByText('Person detail page')).toBeInTheDocument();
  });

  it('renders nothing once loading is done and there are no relationships', () => {
    useNodeGraphServiceMock.mockReturnValue({ data: { nodes: [], links: [] }, loading: false, error: null });

    const { container } = renderCards();

    expect(container).toBeEmptyDOMElement();
  });

  it('shows loading skeleton cards instead of neighbor data while the fetch is in flight', () => {
    useNodeGraphServiceMock.mockReturnValue({ data: null, loading: true, error: null });

    renderCards();

    expect(screen.queryByText('Frida Friend')).not.toBeInTheDocument();
    expect(screen.getByText('Relationship Cards')).toBeInTheDocument();
  });

  it('does not wrap a card in a Link when the neighbor type has no detail route', async () => {
    useNodeGraphServiceMock.mockReturnValue({
      data: {
        nodes: [
          SUBGRAPH.nodes[0],
          {
            id: 'thread-1',
            entity_id: 'thread-1',
            entity_type: 'unknown-kind',
            name: 'Mystery Thread',
            description: null,
            properties: {},
          },
        ],
        links: [
          {
            id: 'rel-2',
            relationship_id: 'rel-2',
            source: FOCUS_ID,
            target: 'thread-1',
            relationship_type: 'RELATES_TO',
            strength: 0.4,
            properties: {},
          },
        ],
      },
      loading: false,
      error: null,
    });

    renderCards();

    await waitFor(() => expect(screen.getByText('Mystery Thread')).toBeInTheDocument());
    expect(screen.getByText('Mystery Thread').closest('a')).toBeNull();
  });
});
