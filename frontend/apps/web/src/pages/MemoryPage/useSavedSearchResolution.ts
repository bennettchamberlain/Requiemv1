import { useEffect, useState } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID } from '@ci/common';
import { ENTITY_TYPE_REVERSE_MAP } from '@ci/common/src/constants';
import { useSearchParams } from 'react-router-dom';

import { excludedEntityTypesFor } from '@/components/SearchBox/useDropdown';
import { gql } from '@/graphql';

import { isRollingDatePreset, resolveDatePreset, type DatePreset } from './Components/ExplorerToolbar/datePresets';

export const GET_SAVED_SEARCH = gql(`
  query GetSavedSearch($id: ID!) {
    savedSearch(id: $id) {
      id
      name
      description
      query
      entityTypes
      tags
      filters {
        eventTypes
        startTime
        endTime
        datePreset
        sortBy
        sortOrder
        connectors
        people
        places
        hasLocation
        semantic
      }
    }
  }
`);

/**
 * Resolves `?saved_search=<id>` into the explorer's URL filter params.
 *
 * Lives in the shared MemoryPage parent (not in DesktopMemoryPage, where this
 * used to be) so both DesktopMemoryPage and MobileMemoryPage — which read
 * their filters from the same URL via useEntityService — receive the
 * resolved saved search identically. Before this moved here, opening a
 * `?saved_search=` link on a phone silently landed on the unfiltered
 * explorer, because MobileMemoryPage never read the param.
 */
export function useSavedSearchResolution() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchId, setSearchId] = useState<string | null>(null);

  const { data: savedSearchData } = useQuery(GET_SAVED_SEARCH, {
    variables: { id: GlobalUID.encode('saved-search', searchId!) },
    skip: !searchId,
  });

  useEffect(() => {
    if (savedSearchData?.savedSearch) {
      const currentParams = new URLSearchParams(searchParams);
      const { entityTypes, query, tags, filters } = savedSearchData.savedSearch;

      // Clear every param a saved search owns so a stale filter from the prior
      // view can't survive the restore.
      for (const key of [
        'search',
        'excludedEntityTypes',
        'includedEntityTypes',
        'saved_search',
        'tags',
        'eventTypes',
        'from',
        'to',
        'when',
        'sortBy',
        'sortOrder',
        'connectors',
        'people',
        'places',
        'hasLocation',
        'semantic',
      ]) {
        currentParams.delete(key);
      }

      if (query?.trim()) {
        currentParams.set('search', query.trim());
      }

      if (entityTypes?.length && entityTypes.length > 0) {
        const reverseMapped = entityTypes.map(
          (type) => ENTITY_TYPE_REVERSE_MAP[type as keyof typeof ENTITY_TYPE_REVERSE_MAP],
        );
        // Same exclude-list the What pickers write, so a restored search hides
        // answers too rather than mixing them in with the saved types.
        const inverseEntityTypes = excludedEntityTypesFor(reverseMapped);

        if (inverseEntityTypes.length > 0) {
          currentParams.set('excludedEntityTypes', inverseEntityTypes.join(','));
        }
      }

      //Updating included entities is handled in SearchBox.tsx

      if (tags?.length && tags.length > 0) {
        currentParams.set('tags', tags.join(','));
      }

      // Secondary dimensions (who / where / when / how / sort / semantic). The
      // `filters` keys mirror the explorer URL params 1:1 except for the date
      // range (startTime -> ?from, endTime -> ?to).
      if (filters) {
        const setCsv = (param: string, value?: readonly string[] | null) => {
          if (value && value.length > 0) {
            currentParams.set(param, value.join(','));
          }
        };

        setCsv('eventTypes', filters.eventTypes);
        setCsv('connectors', filters.connectors);
        setCsv('people', filters.people);
        setCsv('places', filters.places);

        if (isRollingDatePreset(filters.datePreset)) {
          currentParams.set('when', filters.datePreset);
          const { from, to } = resolveDatePreset(filters.datePreset as DatePreset);
          currentParams.set('from', from);
          currentParams.set('to', to);
        } else {
          if (filters.startTime) {
            currentParams.set('from', filters.startTime);
          }

          if (filters.endTime) {
            currentParams.set('to', filters.endTime);
          }

          if (filters.startTime || filters.endTime) {
            currentParams.set('when', 'custom');
          }
        }

        if (filters.sortBy) {
          currentParams.set('sortBy', filters.sortBy);
        }

        if (filters.sortOrder) {
          currentParams.set('sortOrder', filters.sortOrder);
        }

        if (filters.hasLocation) {
          currentParams.set('hasLocation', '1');
        }

        if (filters.semantic) {
          currentParams.set('semantic', '1');
        }
      }

      setSearchParams(currentParams);
    }
  }, [searchId, savedSearchData]);

  useEffect(() => {
    const savedSearchId = searchParams.get('saved_search') || '';
    if (savedSearchId?.length > 0) {
      setSearchId(savedSearchId);
    }
  }, []);
}
