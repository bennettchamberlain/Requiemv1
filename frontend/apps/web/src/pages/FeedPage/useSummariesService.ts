import { useEffect } from 'react';

import { useLazyQuery } from '@apollo/client';

import { gql } from '@/graphql';
import { useAuth } from '@/hooks';

const GET_SUMMARIES = gql(`
  query GetSummaries($first: Int) {
    summaries(first: $first) {
      edges {
        node {
          id
          ...SummaryCardData
        }
      }
      pageInfo {
        hasNextPage
      }
      totalCount
    }
  }
`);

export function useSummariesService(limit: number = 10) {
  const [{ authToken, user, loading: authLoading }] = useAuth();

  const shouldSkipQuery = authLoading || !authToken || !user;

  const [fetchSummaries, { data, loading: summariesLoading, error }] = useLazyQuery(GET_SUMMARIES, {
    fetchPolicy: 'cache-and-network',
    notifyOnNetworkStatusChange: true,
  });

  useEffect(() => {
    if (shouldSkipQuery || !authToken) {
      return;
    }

    fetchSummaries({
      variables: { first: limit },
      context: {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    });
  }, [fetchSummaries, shouldSkipQuery, limit, authToken]);

  const isUnauthorizedError = Boolean(
    error?.graphQLErrors?.some((graphQLError) => graphQLError.message === 'User authentication required'),
  );

  if (error && !isUnauthorizedError) {
    console.error('GraphQL error in useSummariesService:', error);
  }

  const summaries = data?.summaries?.edges.map(({ node }) => node) || [];

  return [
    {
      data: summaries,
      loading: shouldSkipQuery ? authLoading : summariesLoading,
      error: isUnauthorizedError ? undefined : error,
    },
  ] as const;
}
