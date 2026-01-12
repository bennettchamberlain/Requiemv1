import { useMemo } from 'react';

import { useQuery } from '@apollo/client';

import { gql } from '@/graphql';

const SEARCH_QUERY = gql(`
  query Search($query: String!, $includeTypes: [String!], $excludeTypes: [String!]) {
    search(input: { query: $query, includeTypes: $includeTypes, excludeTypes: $excludeTypes }) {
      edges {
        node {
          __typename

          ... on Node {
            id
          }

          ...GalleryAnswerCardData
          ...GalleryBrowserActivityCardData
          ...GalleryCommunicationCardData
          ...GalleryConceptCardData
          ...GalleryContentCardData
          ...GalleryEventCardData
          ...GalleryFileCardData
          ...GalleryNoteCardData
          ...GalleryItemCardData
          ...GalleryPersonCardData
          ...GalleryPlaceCardData
          ...GalleryThreadCardData

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
        }
      }
    }
  }
`);

export function useMemoryServiceNext({
  searchQuery,
  includeTypes,
  excludeTypes,
}: {
  searchQuery: string;
  includeTypes?: string[];
  excludeTypes?: string[];
}) {
  const { data, loading, error } = useQuery(SEARCH_QUERY, {
    variables: {
      query: searchQuery,
      includeTypes: includeTypes?.map((type) => type.toLowerCase()) || [],
      excludeTypes: excludeTypes?.map((type) => type.toLowerCase()) || [],
    },
  });

  const results = useMemo(() => (data?.search?.edges ?? []).map((edge) => edge.node), [data]);

  return {
    data: results,
    loading,
    error,
  };
}
