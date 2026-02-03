import { gql, useMutation, useQuery } from '@apollo/client';

import { type Action } from './types';

const GET_ACTIONS = gql`
  query GetActions {
    actions {
      edges {
        node {
          id
          title
          text
          imageUrl
          seen
          thread {
            id
          }
          tags {
            id
            label
          }
        }
      }
      thread {
        id
      }
      tags {
        id
        label
      }
    }
  }
`;

interface GetActionsResponse {
  actions: {
    edges: {
      node: {
        id: string;
        title: string;
        text: string;
        imageUrl?: string;
        seen?: boolean;
        thread: {
          id: string;
        };
        tags: {
          label: string;
        }[];
      };
    }[];
  }[];
}

export function useActionListService(limit: number = 5) {
  const { data, loading, error, refetch } = useQuery<GetFeedActionsResponse>(GET_FEED_ACTIONS, {
    variables: { limit },
  });

  const [markAsSeen] = useMutation(MARK_ACTION_AS_SEEN);

  const actions: Action[] =
    data?.feedActions
      ?.filter((node): node is NonNullable<typeof node> => !!node)
      .map((node) => ({
        id: node.id ? atob(node.id).split(':')[1] : '',
        title: node.title,
        text: node.text,
        imageUrl: node.imageUrl,
        seen: node.seen ?? false,
        threadId: node.thread?.id ? atob(node.thread.id).split(':')[1] : undefined,
        tags: node.tags?.map((t) => t.label) || [],
      })) || [];

  const markActionAsSeen = async (actionId: string) => {
    // Encode the ID back to GlobalUID format
    const gid = btoa(`action:${actionId}`);
    await markAsSeen({ variables: { id: gid } });
    refetch();
  };

  return [
    {
      data: actions,
      loading,
      error,
    },
    {
      refetch,
      markActionAsSeen,
    },
  ] as const;
}
