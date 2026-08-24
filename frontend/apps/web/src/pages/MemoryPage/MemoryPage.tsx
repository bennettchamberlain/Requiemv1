import { lazy } from 'react';

import { usePageTitle } from '@ci/common';
import { Navigate, useSearchParams } from 'react-router-dom';

import { ResponsiveLoader } from '@/components/ResponsiveLoader';

import { EntityServiceProvider } from '../MemoryPage/useEntityService';

import { parseBbox } from './bbox';
import { explorerSearchTypeFilters } from './Components/ExplorerToolbar/filterParams';

const DesktopPage = lazy(() => import('./DesktopMemoryPage'));
const MobilePage = lazy(() => import('./MobileMemoryPage'));

/**
 * What a BARE `/memory/events` means: the list view, events only.
 *
 * Without a type filter the explorer returns every entity kind, and the
 * newest-first list led with whatever imported last — including undated
 * Content rows, which aren't memories of anything happening. The default is
 * expressed as an ordinary URL rather than hidden query plumbing, so the
 * toolbar shows the Event filter as an applied, removable chip and widening
 * the view is the same gesture as any other filter change.
 *
 * ONLY the fully-bare URL gets it. A deep link that carries any param keeps
 * its exact meaning: `?search=` (the global search box) and `?tags=` must
 * search everything, `?view=graph` (`/memory/knowledge`) already narrows
 * nothing — forcing Event onto those would silently shrink their results.
 * In-page filter changes never re-trigger it either, because the toolbar
 * always keeps `view` while clearing filters.
 */
export const DEFAULT_MEMORY_EVENTS_SEARCH = 'view=list&includedEntityTypes=Event,Communication';

/**
 * The explorer's query comes from the URL and nothing else. Every view — List,
 * Gallery, Map, Graph, Timeline — reads this one filter set, so the same link
 * means the same thing wherever it opens.
 *
 * Two filters used to be derived from `?view=` here instead: the gallery forced
 * `includeFiles` on and the map forced `hasLocation` on. Switching views
 * silently changed the result set, and the toolbar showed no sign of it — the
 * map's coercion also made the whole browse events-only, because `hasLocation`
 * puts the server on its event-filter path. Both are gone. Files now follow the
 * What picker's File type like every other type, and the Map tab applies
 * "Has a location" as a visible, removable filter when you click it (see
 * DesktopMemoryPage/MobileMemoryPage). Filters a view genuinely cannot honour
 * are marked as such in the toolbar — see Components/ExplorerToolbar/viewFilterSupport.
 */
export function MemoryPage() {
  usePageTitle('Memory - Companion Intelligence');
  const [searchParams] = useSearchParams();

  // Before the provider mounts, so the unfiltered everything-query never fires.
  if ([...searchParams.keys()].length === 0) {
    return <Navigate to={{ search: DEFAULT_MEMORY_EVENTS_SEARCH }} replace />;
  }

  const typeFilters = explorerSearchTypeFilters(searchParams);

  return (
    <EntityServiceProvider
      args={[
        {
          searchQuery: searchParams.get('search') || '',
          includeTypes: typeFilters.includeTypes,
          excludeTypes: typeFilters.excludeTypes,
          eventTypes: searchParams.get('eventTypes')?.split(',').filter(Boolean) || undefined,
          tags: searchParams.get('tags')?.split(',').filter(Boolean) || undefined,
          startTime: searchParams.get('from') || undefined,
          endTime: searchParams.get('to') || undefined,
          sortBy: searchParams.get('sortBy') || undefined,
          sortOrder: searchParams.get('sortOrder') || undefined,
          // LifeScope-parity dimensions (who / where / connector / semantic).
          connectors: searchParams.get('connectors')?.split(',').filter(Boolean) || undefined,
          people: searchParams.get('people')?.split(',').filter(Boolean) || undefined,
          places: searchParams.get('places')?.split(',').filter(Boolean) || undefined,
          hasLocation: searchParams.get('hasLocation') === '1' || undefined,
          bbox: parseBbox(searchParams.get('bbox')),
          semantic: searchParams.get('semantic') === '1' || undefined,
        },
      ]}
    >
      <ResponsiveLoader desktop={DesktopPage} mobile={MobilePage} />
    </EntityServiceProvider>
  );
}
