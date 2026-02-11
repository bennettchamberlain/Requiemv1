import { gql, useMutation, useQuery } from '@apollo/client';

interface InsightNode {
  title: string;
  summaryText: string;
  keyActions: string[];
  relevanceScore: number;
  tags: string[];
  relatedEntityIds?: string[] | null;
}

interface SummaryNode {
  id: string;
  title?: string | null;
  periodType: string;
  seen: boolean;
  summaryText: string;
  keyInsights: string[];
  tags: string[];
  activityCounts: {
    total: number;
  };
  insights: InsightNode[];
}

interface GetSummariesQueryResult {
  summaries: {
    edges: Array<{
      node: SummaryNode;
    }>;
    pageInfo: {
      hasNextPage: boolean;
    };
    totalCount: number;
  };
}

interface GetSummariesQueryVariables {
  first?: number;
}

interface MarkSummaryAsSeenMutationResult {
  markSummaryAsSeen?: {
    id: string;
    seen: boolean;
  } | null;
}

interface MarkSummaryAsSeenMutationVariables {
  id: string;
}

const GET_SUMMARIES = gql`
  query GetSummaries($first: Int) {
    summaries(first: $first) {
      edges {
        node {
          id
          title
          periodType
          seen
          summaryText
          keyInsights
          tags
          activityCounts {
            total
          }
          insights {
            title
            summaryText
            keyActions
            relevanceScore
            tags
            relatedEntityIds
          }
        }
      }
      pageInfo {
        hasNextPage
      }
      totalCount
    }
  }
`;

const MARK_SUMMARY_AS_SEEN = gql`
  mutation MarkSummaryAsSeen($id: ID!) {
    markSummaryAsSeen(id: $id) {
      id
      seen
    }
  }
`;

export function useSummariesService(first?: number) {
  const { data, loading, error, refetch } = useQuery<GetSummariesQueryResult, GetSummariesQueryVariables>(
    GET_SUMMARIES,
    {
      variables: { first },
      fetchPolicy: 'cache-and-network',
      notifyOnNetworkStatusChange: true,
    },
  );
  const [markSeenMutation] = useMutation<MarkSummaryAsSeenMutationResult, MarkSummaryAsSeenMutationVariables>(
    MARK_SUMMARY_AS_SEEN,
  );

  const summaries: SummaryNode[] = data?.summaries?.edges.map(({ node }) => node) || [];

  const markSummaryAsSeen = async (id: string) => {
    await markSeenMutation({ variables: { id } });
    await refetch();
  };

  return [
    {
      data: summaries,
      loading: loading,
      error: error,
    },
    {
      refetch,
      markSummaryAsSeen,
    },
  ] as const;
}
