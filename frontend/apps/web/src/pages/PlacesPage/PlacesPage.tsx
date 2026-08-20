import { type ReactNode, useCallback, useMemo, useState } from 'react';

import { useMutation, useQuery } from '@apollo/client';
import { EmptyState, GlobalUID, LoadingPage, usePageTitle } from '@ci/common';
import { Badge, Button, Card, Input } from '@ci/shadcn';
import { MapPin, Plus } from '@ci/shadcn/icons';
import { useNavigate } from 'react-router-dom';

import { InfiniteListFooter } from '@/components/InfiniteList';
import { PageContent } from '@/components/layout';
import { Map } from '@/components/Map';
import { MemoryHubShell } from '@/components/MemoryHub';
import { AddPlaceModal } from '@/components/modals/AddItemModal';
import { PLACE_KIND_LABELS } from '@/components/PlaceForm';
import { gql } from '@/graphql';
import type { GetPlacesQuery } from '@/graphql/graphql';
import { useModalControls } from '@/hooks';
import { useInfiniteConnection } from '@/hooks/useInfiniteConnection';

/**
 * Each row costs a `visitStats` aggregate, so this stays well under the old
 * fixed `first: 500` — the rest now arrives by scrolling instead of being
 * silently withheld.
 */
export const PAGE_SIZE = 200;

/**
 * Leaflet degrades badly past a few hundred individual markers. The cap stays,
 * but the page now says so instead of quietly dropping pins.
 */
const MAX_MAP_MARKERS = 300;

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
            status
          }
        }
      }
    }
  }
`);

const GET_KNOWN_PLACES = gql(`
  query GetKnownPlaces {
    geocodingConfigured
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

type PlaceNode = GetPlacesQuery['places']['edges'][number]['node'];

function formatDate(value: string | Date | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

function PlaceRow({ place, onOpen }: { place: PlaceNode; onOpen: () => void }) {
  const lastVisit = formatDate(place.visitStats.lastVisitAt);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left transition hover:bg-accent"
    >
      <MapPin className="h-5 w-5 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{place.name || 'Unnamed place'}</span>
          {place.placeKind && (
            <Badge variant="secondary">{PLACE_KIND_LABELS[place.placeKind] ?? place.placeKind}</Badge>
          )}
        </div>

        <div className="truncate text-sm text-muted-foreground">
          {[place.parent?.name, place.description].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>

      <div className="hidden shrink-0 text-right text-sm text-muted-foreground sm:block">
        {place.visitStats.visitCount === 0 && place.visitStats.status === 'pending_enrichment' ? (
          // A zero here isn't yet a measurement (geocoding unconfigured, or
          // this place's events haven't finished linking) — distinct from a
          // place that is genuinely never visited, which reads "0 visits".
          <div title="Geocoding isn't finished linking events to this place yet">Visits pending</div>
        ) : (
          <div>
            {place.visitStats.visitCount} {place.visitStats.visitCount === 1 ? 'visit' : 'visits'}
          </div>
        )}
        {lastVisit && <div>Last {lastVisit}</div>}
      </div>
    </button>
  );
}

/** Rough metres between two lat/lng pairs (equirectangular is plenty here). */
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x = toRad(bLng - aLng) * Math.cos(toRad((aLat + bLat) / 2));
  const y = toRad(bLat - aLat);

  return Math.sqrt(x * x + y * y) * 6371000;
}

/** A candidate within this radius of a confirmed place is that place. */
const CONFIRMED_MATCH_METERS = 150;

function KnownPlacesCard() {
  const { data, refetch } = useQuery(GET_KNOWN_PLACES);
  const [confirmKnownPlace, { loading }] = useMutation(CONFIRM_KNOWN_PLACE);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const knownPlaces = useMemo(() => data?.knownPlaces ?? [], [data]);
  const confirmedLocationIds = useMemo(
    () => new Set(knownPlaces.map((place) => place.locationId)),
    [knownPlaces],
  );

  // Grid-cluster candidates always carry locationId: null and are regenerated
  // by every buildKnownPlaces call, so an id-only filter would show a
  // just-confirmed cluster forever. Also drop candidates that match a confirmed
  // place by label or by proximity to its coordinates.
  const candidates = useMemo(
    () =>
      (data?.knownPlaceCandidates ?? []).filter((candidate) => {
        if (candidate.locationId != null && confirmedLocationIds.has(candidate.locationId)) {
          return false;
        }

        return !knownPlaces.some((place) => {
          if (place.label.trim().toLowerCase() === candidate.label.trim().toLowerCase()) {
            return true;
          }

          const coordinates = place.coordinates;

          return (
            coordinates != null &&
            distanceMeters(coordinates.lat, coordinates.lng, candidate.lat, candidate.lng) <=
              CONFIRMED_MATCH_METERS
          );
        });
      }),
    [data, knownPlaces, confirmedLocationIds],
  );

  if (knownPlaces.length === 0 && candidates.length === 0) {
    return null;
  }

  const confirm = async (candidate: (typeof candidates)[number]) => {
    try {
      setConfirmError(null);
      await confirmKnownPlace({
        variables: {
          input: {
            label: candidate.label,
            kind: candidate.kind,
            locationId: candidate.locationId,
            coordinates: { lat: candidate.lat, lng: candidate.lng },
            confidence: candidate.confidence,
            source: 'inferred',
          },
        },
      });
      await refetch();
    } catch (error) {
      setConfirmError(
        error instanceof Error ? error.message : 'Could not confirm that place. Please try again.',
      );
    }
  };

  return (
    <Card>
      <Card.Header>
        <Card.Title className="text-base">Known places</Card.Title>
        <Card.Description>
          Frequent places detected from your events. Confirm them so home and work anchor your memory.
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        {confirmError && <div className="text-sm text-destructive">{confirmError}</div>}

        {data?.geocodingConfigured === false && candidates.length > 0 && (
          // Every candidate below defaults to "Unknown place · looks like
          // Other" when reverse-geocoding hasn't named it — which, without
          // this note, reads as a fact about the places rather than as
          // configuration work not yet done.
          <div className="text-sm text-muted-foreground">
            Geocoding isn&apos;t configured on this appliance, so these places haven&apos;t been named yet.
          </div>
        )}

        {knownPlaces.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {knownPlaces.map((place) => (
              <Badge key={place.id} variant="secondary" className="capitalize">
                {place.kind}: {place.label}
              </Badge>
            ))}
          </div>
        )}

        {candidates.slice(0, 6).map((candidate) => (
          <div
            key={`${candidate.label}:${candidate.lat}:${candidate.lng}`}
            className="flex items-center gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{candidate.label}</div>
              <div className="text-sm text-muted-foreground">
                {candidate.eventCount} events · looks like{' '}
                <span className="capitalize">{candidate.kind}</span>
              </div>
            </div>
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void confirm(candidate)}>
              Confirm {candidate.kind}
            </Button>
          </div>
        ))}
      </Card.Content>
    </Card>
  );
}

export function PlacesPage() {
  usePageTitle('Places - Companion Intelligence');

  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  const [{ isOpen: isAddPlaceOpen }, { open: openAddPlace, close: closeAddPlace }] = useModalControls();

  const { data, previousData, loading, error, refetch, fetchMore } = useQuery(GET_PLACES, {
    variables: { query: searchQuery.trim() === '' ? null : searchQuery.trim(), first: PAGE_SIZE },
    notifyOnNetworkStatusChange: true,
  });

  // Keep the previous result rendered while a new query variable is in flight;
  // swapping to a full-page loader would unmount the search input and drop
  // focus on the first keystroke of every new query.
  const view = data ?? previousData;
  const places = useMemo(() => (view?.places.edges ?? []).map((edge) => edge.node), [view]);

  const fetchNextPage = useCallback(
    (after: string) =>
      fetchMore({
        variables: { after },
        updateQuery: (prev, { fetchMoreResult }) => {
          if (!fetchMoreResult?.places) {
            return prev;
          }

          const prevEdges = prev.places?.edges ?? [];
          const seen = new Set(prevEdges.map((edge) => edge.cursor));
          const nextEdges = fetchMoreResult.places.edges.filter((edge) => !seen.has(edge.cursor));

          return {
            places: {
              ...fetchMoreResult.places,
              edges: [...prevEdges, ...nextEdges],
            },
          };
        },
      }),
    [fetchMore],
  );

  const pagination = useInfiniteConnection({
    connection: view?.places,
    loadedCount: places.length,
    fetchNextPage,
  });

  const locatedPlaces = useMemo(
    () =>
      places.filter(
        (place): place is PlaceNode & { latitude: number; longitude: number } =>
          typeof place.latitude === 'number' && typeof place.longitude === 'number',
      ),
    [places],
  );

  const mapCenter = useMemo<[number, number]>(() => {
    if (locatedPlaces.length === 0) {
      return [37.7749, -122.4194];
    }

    const lat = locatedPlaces.reduce((sum, place) => sum + place.latitude, 0) / locatedPlaces.length;
    const lng = locatedPlaces.reduce((sum, place) => sum + place.longitude, 0) / locatedPlaces.length;

    return [lat, lng];
  }, [locatedPlaces]);

  let content: ReactNode | null = null;

  if (loading && view == null) {
    content = <LoadingPage />;
  } else if (error && view == null) {
    content = <EmptyState message={`Couldn't load places: ${error.message}`} />;
  } else {
    content = (
      <PageContent ref={pagination.scrollRef} className="gap-4 p-0">
        <MemoryHubShell
          actions={
            <Button size="sm" onClick={openAddPlace}>
              <Plus className="h-4 w-4" />
              New place
            </Button>
          }
        >
          <div className="flex flex-col gap-4 px-4 pb-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search places by name..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  // New query, new cursor space — a stale failure must not gate it.
                  pagination.reset();
                }}
                className="max-w-xl flex-1"
              />
              <div className="text-sm text-muted-foreground">{pagination.totalCount} places</div>
            </div>

            <KnownPlacesCard />

            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              {locatedPlaces.length > 0 && (
                <div className="flex-1 lg:sticky lg:top-4">
                  <div className="h-72 overflow-hidden rounded-md border lg:h-[calc(100vh-14rem)] lg:min-h-72">
                    <Map center={mapCenter} zoom={locatedPlaces.length === 1 ? 13 : 3}>
                      {locatedPlaces.slice(0, MAX_MAP_MARKERS).map((place) => (
                        <Map.Marker
                          key={place.id}
                          variant="place"
                          position={[place.latitude, place.longitude]}
                          onClick={() => navigate(`/places/${GlobalUID.parse('place', place.id)}`)}
                        />
                      ))}
                    </Map>
                  </div>

                  {locatedPlaces.length > MAX_MAP_MARKERS && (
                    <div className="pt-1 text-xs text-muted-foreground">
                      Map shows the first {MAX_MAP_MARKERS} of {locatedPlaces.length} places with coordinates.
                    </div>
                  )}
                </div>
              )}

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {places.length === 0 ? (
                  <EmptyState message="No places found" />
                ) : (
                  <>
                    {places.map((place) => (
                      <PlaceRow
                        key={place.id}
                        place={place}
                        onOpen={() => navigate(`/places/${GlobalUID.parse('place', place.id)}`)}
                      />
                    ))}

                    <InfiniteListFooter pagination={pagination} noun="places" />
                  </>
                )}
              </div>
            </div>
          </div>
        </MemoryHubShell>
      </PageContent>
    );
  }

  return (
    <>
      {content}

      {/* A created place has no connection for Apollo to write into — the list
          is a fresh `places(query:)` result — so refetch rather than trying to
          patch the cache. refetch replays the hook's original variables
          (`first: PAGE_SIZE`, no cursor), so the accumulated list goes back to
          its first page; reset() clears any latched load-more failure with it,
          otherwise the sentinel would stay gated over a brand-new cursor space. */}
      <AddPlaceModal
        open={isAddPlaceOpen}
        onClose={closeAddPlace}
        onCreated={() => {
          pagination.reset();
          void refetch();
        }}
      />
    </>
  );
}
