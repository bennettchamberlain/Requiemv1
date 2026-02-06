import { useQuery } from '@apollo/client';

import { gql } from '@/graphql';

const USER_DATA_QUERY = gql(`
  query GetUserData {
    me {
      id
      name
      email
      onboarded

      entity {
        id
      }
    }
  }
`);

export function useCurrentUser() {
  const { data, loading, error, refetch } = useQuery(USER_DATA_QUERY);

  const user = data?.me || null;

  return { user, loading, error, refetch };
}
