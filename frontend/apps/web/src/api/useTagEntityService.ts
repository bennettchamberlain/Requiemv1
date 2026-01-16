import { useMutation } from '@apollo/client';

import { gql } from '@/graphql';

const TAG_ENTITIES = gql(`
  mutation TagEntities($input: TagEntitiesInput!) {
    tagEntities(input: $input) {
      tags {
        label
      }
      ... on Node {
        id
      }
    }
  }
`);

const UNTAG_ENTITIES = gql(`
  mutation UntagEntities($input: TagEntitiesInput!) {
    untagEntities(input: $input) {
      tags {
        label
      }
      ... on Node {
        id
      }
    }
  }
`);

export function useTagEntityService() {
  const [tagEntitiesMutation] = useMutation(TAG_ENTITIES);
  const [untagEntitiesMutation] = useMutation(UNTAG_ENTITIES);

  const tagEntities = async (ids: string[], labels: string[]) => {
    return tagEntitiesMutation({
      variables: {
        input: {
          ids,
          labels,
        },
      },
    });
  };

  const untagEntities = async (ids: string[], labels: string[]) => {
    return untagEntitiesMutation({
      variables: {
        input: {
          ids,
          labels,
        },
      },
    });
  };

  return {
    tagEntities,
    untagEntities,
  };
}
