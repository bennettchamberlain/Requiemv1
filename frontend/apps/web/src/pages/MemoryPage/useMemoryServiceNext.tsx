import { useMemo } from 'react';

import { useQuery } from '@apollo/client';

import { gql } from '@/graphql';

const SEARCH_QUERY = gql(`
  query Search($query: String!) {
    search(input: { query: $query }) {
      edges {
        node {
          __typename
          ...GalleryAnswerCardData
          ...GalleryBrowserActivityCardData
          ...GalleryCommunicationCardData
          ...GalleryContentCardData
          ...GalleryEventCardData
          ...GalleryFileCardData
          ...GalleryItemCardData
          ...GalleryPersonCardData
          ...GalleryPlaceCardData
          ...GalleryThreadCardData
        }
      }
    }
  }
`);

export function useMemoryServiceNext(searchQuery: string) {
  const { data, loading, error } = useQuery(SEARCH_QUERY, {
    variables: {
      query: searchQuery,
    },
  });

  const results = useMemo(() => (data?.search?.edges ?? []).map((edge) => edge.node), [data]);

  return {
    data: results,
    loading,
    error,
  };
}
