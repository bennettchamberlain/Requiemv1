import { useMemo, useState } from 'react';

import { useQuery } from '@apollo/client';
import { createHookContext } from '@ci/common';

import type { FragmentType } from '@/graphql';
import { gql } from '@/graphql';

const SEARCH_QUERY = gql(`
  query Search($query: String!, $includeTypes: [String!], $excludeTypes: [String!]) {
    search(input: { query: $query, includeTypes: $includeTNbroypes, excludeTypes: $excludeTypes }) {
      edges {
        node {
          __typename

          ... on Node {
            id
          }

          ...AnswerGridItemData
          ...BrowserActivityGridItemData
          ...CommunicationGridItemData
          ...ConceptGridItemData
          ...ContentGridItemData
          ...EventGridItemData
          ...FileGridItemData
          ...NoteGridItemData
          ...ItemGridItemData
          ...PersonGridItemData
          ...PlaceGridItemData
          ...ThreadGridItemData

          ...TableAnswerRowData
          ...TableCommunicationRowData
          ...TableConceptRowData
          ...TableContentRowData
          ...TableEventRowData
          ...TableFileRowData
          ...TableItemRowData
          ...TableNoteRowData
          ...TablePersonRowData
          ...TablePlaceRowData
          ...TableThreadRowData
          ...TableBrowserActivityRowData

          ...TimelineBrowserActivityCardData
          ...TimelineCommunicationCardData
          ...TimelineEventCardData
        }
      }
    }
  }
`);

type ReturnType = [
  {
    data: Array<FragmentType>;
    loading: boolean;
    error: Error | null;
    activeEntity: FragmentType;
  },
  {
    setActiveEntity: (entity: FragmentType) => void;
  },
];

function useEntityService({
  searchQuery,
  includeTypes,
  excludeTypes,
}: {
  searchQuery: string;
  includeTypes?: string[];
  excludeTypes?: string[];
}): ReturnType {
  const { data, loading, error } = useQuery(SEARCH_QUERY, {
    variables: {
      query: searchQuery,
      includeTypes: includeTypes?.map((type) => type.toLowerCase()) || [],
      excludeTypes: excludeTypes?.map((type) => type.toLowerCase()) || [],
    },
  });

  console.log('data', data);
  const [activeEntity, setActiveEntity] = useState<typeof data>(null);

  const results = useMemo(() => (data?.search?.edges ?? []).map((edge) => edge.node), [data]);

  return [
    {
      data: results,
      loading,
      error,
      activeEntity,
    },
    {
      setActiveEntity,
    },
  ];
}

const { Provider: EntityServiceProvider, useHookContext } = createHookContext(useEntityService);

export { EntityServiceProvider, useHookContext as useEntityService };
