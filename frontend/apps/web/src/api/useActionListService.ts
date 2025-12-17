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
          thread {
            id
          }
          tags {
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
    data?.actions.edges.map(({ node }) => ({
      id: atob(node.id).split(':')[1],
      title: node.title,
      text: node.text,
      imageUrl: node.imageUrl,
      threadId: atob(node.thread.id).split(':')[1],
      tags: node.tags.map((t) => t.label),
    })) || [];

  return [
    {
      data: actions,
      loading,
      error,
    },
  ];
}
