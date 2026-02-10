import { gql, useQuery } from '@apollo/client';

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
  };
}

export function useActionListService() {
  const { data, loading, error } = useQuery<GetActionsResponse>(GET_ACTIONS);

  const actions: Action[] =
    data?.actions.edges
      .map(({ node }) => node)
      .filter((node): node is NonNullable<typeof node> => !!node)
      .map((node) => ({
        id: node.id ? atob(node.id).split(':')[1] : '',
        title: node.title,
        text: node.text,
        imageUrl: node.imageUrl,
        seen: node.seen ?? false,
        threadId: node.thread?.id ? atob(node.thread.id).split(':')[1] : undefined,
        tags: node.tags?.map((t) => t.label) || [],
      })) || [];

  return [
    {
      data: actions,
      loading,
      error,
    },
  ];
}
