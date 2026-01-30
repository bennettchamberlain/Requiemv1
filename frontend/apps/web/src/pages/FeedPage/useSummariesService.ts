import { useQuery } from '@apollo/client';

import { gql } from '@/graphql';

const GET_SUMMARIES = gql(`
  query GetSummaries($first: Int) {
    summaries(first: $first) {
      edges {
        node {
          id
          periodType
          ...SummaryCardData
          insights {
            ...InsightCardData
          }
        }
      }
      pageInfo {
        hasNextPage
      }
      totalCount
    }
  }
`);

export function useSummariesService() {
  const { data, loading, error } = useQuery(GET_SUMMARIES, {
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  });

  const summaries = data?.summaries?.edges.map(({ node }) => node) || [];

  return [
    {
      data: summaries,
      loading: loading,
      error: error,
    },
  ] as const;
}
