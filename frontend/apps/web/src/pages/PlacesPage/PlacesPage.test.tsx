import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { gql } from '@/graphql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { PAGE_SIZE, PlacesPage } from './PlacesPage';

const navigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();

  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/components/MemoryHub', () => ({
  MemoryHubShell: ({ children }: { children: React.ReactNode }) => children,
}));

const GET_PLACES = gql(`
  query GetPlaces($query: String, $first: Int, $after: String) {
    places(query: $query, first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          name
          description
          placeKind
          latitude
          longitude
          parent {
            id
            name
            placeKind
          }
          visitStats {
            visitCount
            firstVisitAt
            lastVisitAt
          }
        }
      }
    }
  }
`);

const GET_KNOWN_PLACES = gql(`
  query GetKnownPlaces {
    knownPlaces {
      id
      locationId
      label
      kind
      confidence
      source
      coordinates {
        lat
        lng
      }
    }
    knownPlaceCandidates {
      locationId
      label
      kind
      lat
      lng
      eventCount
      confidence
    }
  }
`);

const CONFIRM_KNOWN_PLACE = gql(`
  mutation ConfirmKnownPlace($input: UpdateKnownPlaceInput!) {
    updateKnownPlace(input: $input) {
      id
      label
      kind
    }
  }
`);

/** See PeoplePage.test.tsx — the suite stubs IntersectionObserver with a no-op. */
function captureIntersectionObserver() {
  const callbacks: IntersectionObserverCallback[] = [];
  const original = globalThis.IntersectionObserver;

  class CapturingObserver {
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback);
    }

    observe() {}

    unobserve() {}

    disconnect() {}

    takeRecords() {
      return [];
    }
  }

  globalThis.IntersectionObserver = CapturingObserver as unknown as typeof IntersectionObserver;

  return {
    scrollSentinelIntoView: async () => {
      await act(async () => {
        for (const callback of callbacks) {
          callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
        }
      });
    },
    restore: () => {
      globalThis.IntersectionObserver = original;
    },
  };
}

function pageInfo(overrides: { hasNextPage?: boolean; endCursor?: string | null } = {}) {
  return {
    __typename: 'PageInfo' as const,
    hasNextPage: overrides.hasNextPage ?? false,
    endCursor: overrides.endCursor ?? null,
  };
}

/** An empty places list — these tests exercise KnownPlacesCard, not the list/map below it. */
function emptyPlacesMock() {
  return placesMock({ totalCount: 0, edges: [] });
}

function knownPlacesMock(overrides: { knownPlaces?: unknown[]; knownPlaceCandidates?: unknown[] } = {}) {
  return {
    request: { query: GET_KNOWN_PLACES },
    result: {
      data: {
        knownPlaces: overrides.knownPlaces ?? [],
        knownPlaceCandidates: overrides.knownPlaceCandidates ?? [],
      },
    },
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'KnownPlaceCandidateType' as const,
    locationId: 'loc-1',
    label: 'Corner Cafe',
    kind: 'venue',
    lat: 37.7749,
    lng: -122.4194,
    eventCount: 12,
    confidence: 0.8,
    ...overrides,
  };
}

function knownPlace(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'KnownPlaceType' as const,
    id: 'kp-1',
    locationId: 'loc-home',
    label: 'Home',
    kind: 'home',
    confidence: 1,
    source: 'confirmed',
    coordinates: { __typename: 'KnownPlaceCoordinates' as const, lat: 37.7, lng: -122.4 },
    ...overrides,
  };
}

/**
 * `/places/:id` carries the RAW uuid — `PlacePage` re-encodes it with
 * `GlobalUID.encode('place', id)` before querying. GraphQL `id` fields are
 * global ids (base64 `place:<uuid>`), so routing with one unchanged makes
 * `PlacePage` encode an already-encoded id and render "Place not found".
 */
const PLACE_UUID = '019fd7c0-641c-76dd-8ed7-a5053faff6fd';
const PLACE_GLOBAL_ID = btoa(`place:${PLACE_UUID}`);

function placeEdge({ id = PLACE_GLOBAL_ID, name = 'Bletchley Park' } = {}) {
  return {
    __typename: 'PlaceEdge' as const,
    cursor: id,
    node: {
      __typename: 'PlaceType' as const,
      id,
      name,
      description: null,
      placeKind: null,
      latitude: null,
      longitude: null,
      parent: null,
      visitStats: {
        __typename: 'PlaceVisitStatsType' as const,
        visitCount: 0,
        firstVisitAt: null,
        lastVisitAt: null,
      },
    },
  };
}

function placesMock({
  totalCount = 1,
  hasNextPage = false,
  after,
  edges = [placeEdge()],
}: {
  totalCount?: number;
  hasNextPage?: boolean;
  after?: string;
  edges?: ReturnType<typeof placeEdge>[];
} = {}) {
  return {
    request: {
      query: GET_PLACES,
      variables: { query: null, first: PAGE_SIZE, ...(after == null ? {} : { after }) },
    },
    result: {
      data: {
        places: {
          __typename: 'PlaceConnection' as const,
          totalCount,
          pageInfo: pageInfo({ hasNextPage, endCursor: hasNextPage ? edges.at(-1)?.cursor : null }),
          edges,
        },
      },
    },
  };
}

const mocks = [placesMock(), knownPlacesMock()];

describe('PlacesPage', () => {
  it('routes to the decoded uuid, not the global id, when a place row is opened', async () => {
    navigate.mockClear();
    renderWithProviders(<PlacesPage />, { mocks });

    fireEvent.click(await screen.findByText('Bletchley Park'));

    expect(navigate).toHaveBeenCalledWith(`/places/${PLACE_UUID}`);
    expect(navigate).not.toHaveBeenCalledWith(`/places/${PLACE_GLOBAL_ID}`);
  });

  /**
   * Regression: the query asked for a fixed `first: 500` while the header
   * rendered `totalCount`, so on 1,179 places the page announced a number and
   * then withheld 679 of them with no "load more" and no explanation.
   */
  it('says how many of the counted places are actually listed', async () => {
    renderWithProviders(<PlacesPage />, {
      mocks: [placesMock({ totalCount: 1179, hasNextPage: true }), knownPlacesMock()],
    });

    expect(await screen.findByText('Bletchley Park')).toBeInTheDocument();
    expect(screen.getByText('1179 places')).toBeInTheDocument();
    // The header count no longer stands alone — the footer says what is loaded.
    expect(screen.getByText(/loaded/).textContent).toContain('1 of 1179 loaded');
  });

  it('appends the next page when the sentinel scrolls into view', async () => {
    const SECOND_UUID = '019fd7c0-641c-76dd-8ed7-a5053faff6fe';
    const SECOND_GLOBAL_ID = btoa(`place:${SECOND_UUID}`);
    const observer = captureIntersectionObserver();

    try {
      renderWithProviders(<PlacesPage />, {
        mocks: [
          placesMock({ totalCount: 2, hasNextPage: true }),
          placesMock({
            totalCount: 2,
            after: PLACE_GLOBAL_ID,
            edges: [placeEdge({ id: SECOND_GLOBAL_ID, name: 'Enigma Cottage' })],
          }),
          knownPlacesMock(),
        ],
      });

      expect(await screen.findByText('Bletchley Park')).toBeInTheDocument();
      expect(screen.queryByText('Enigma Cottage')).not.toBeInTheDocument();

      await observer.scrollSentinelIntoView();

      expect(await screen.findByText('Enigma Cottage')).toBeInTheDocument();
      expect(screen.getByText('Bletchley Park')).toBeInTheDocument();
      expect(screen.getByText(/loaded/).textContent).toContain('2 of 2 loaded · end');
    } finally {
      observer.restore();
    }
  });

  describe('KnownPlacesCard', () => {
    it('confirms a candidate and reflects the success by refetching it off the candidate list', async () => {
      renderWithProviders(<PlacesPage />, {
        mocks: [
          emptyPlacesMock(),
          knownPlacesMock({ knownPlaceCandidates: [candidate()] }),
          {
            request: {
              query: CONFIRM_KNOWN_PLACE,
              variables: {
                input: {
                  label: 'Corner Cafe',
                  kind: 'venue',
                  locationId: 'loc-1',
                  coordinates: { lat: 37.7749, lng: -122.4194 },
                  confidence: 0.8,
                  source: 'inferred',
                },
              },
            },
            result: {
              data: {
                updateKnownPlace: {
                  __typename: 'KnownPlaceType' as const,
                  id: 'kp-2',
                  label: 'Corner Cafe',
                  kind: 'venue',
                },
              },
            },
          },
          // Post-mutation refetch: the candidate is now a confirmed known place,
          // and the server no longer returns it as a candidate.
          knownPlacesMock({
            knownPlaces: [
              knownPlace({ id: 'kp-2', locationId: 'loc-1', label: 'Corner Cafe', kind: 'venue' }),
            ],
            knownPlaceCandidates: [],
          }),
        ],
      });

      expect(await screen.findByText('Corner Cafe')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm venue' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Confirm venue' }));

      // The confirmed place appears as a badge and the candidate row is gone,
      // driven entirely by the refetch — no optimistic local removal to fake it.
      expect(await screen.findByText('venue: Corner Cafe')).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Confirm venue' })).not.toBeInTheDocument();
      });
    });

    it('shows a real error and keeps the candidate listed when the confirm mutation fails', async () => {
      renderWithProviders(<PlacesPage />, {
        mocks: [
          emptyPlacesMock(),
          knownPlacesMock({ knownPlaceCandidates: [candidate()] }),
          {
            request: {
              query: CONFIRM_KNOWN_PLACE,
              variables: {
                input: {
                  label: 'Corner Cafe',
                  kind: 'venue',
                  locationId: 'loc-1',
                  coordinates: { lat: 37.7749, lng: -122.4194 },
                  confidence: 0.8,
                  source: 'inferred',
                },
              },
            },
            error: new Error('locationId already claimed'),
          },
        ],
      });

      expect(await screen.findByText('Corner Cafe')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Confirm venue' }));

      expect(await screen.findByText('locationId already claimed')).toBeInTheDocument();
      // The failed candidate is still there to retry, not silently dropped.
      expect(screen.getByText('Corner Cafe')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Confirm venue' })).toBeInTheDocument();
    });

    it('hides a candidate that duplicates an already-confirmed place by name or by nearby coordinates', async () => {
      renderWithProviders(<PlacesPage />, {
        mocks: [
          emptyPlacesMock(),
          knownPlacesMock({
            knownPlaces: [
              knownPlace({ id: 'kp-home', locationId: 'loc-home', label: 'Home', kind: 'home' }),
              knownPlace({
                id: 'kp-work',
                locationId: 'loc-work',
                label: 'Acme Corp',
                kind: 'work',
                coordinates: { __typename: 'KnownPlaceCoordinates' as const, lat: 37.8, lng: -122.5 },
              }),
            ],
            knownPlaceCandidates: [
              // Same label as the confirmed "Home", different casing, no shared
              // locationId — must still be recognised as a duplicate.
              candidate({ locationId: 'loc-2', label: 'home', lat: 10, lng: 10 }),
              // ~11m from the confirmed "Acme Corp" coordinates — well inside the
              // 150m proximity match, no shared label.
              candidate({ locationId: 'loc-3', label: 'Acme Corp Annex', lat: 37.8001, lng: -122.5001 }),
              // A genuinely new place: neither label nor location overlaps.
              candidate({ locationId: 'loc-4', label: 'New Bakery', lat: 1, lng: 1 }),
            ],
          }),
        ],
      });

      expect(await screen.findByText('New Bakery')).toBeInTheDocument();
      expect(screen.queryByText('home')).not.toBeInTheDocument();
      expect(screen.queryByText('Acme Corp Annex')).not.toBeInTheDocument();
    });
  });
});
