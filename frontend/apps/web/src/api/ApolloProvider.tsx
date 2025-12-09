import { useMemo, type ReactNode } from 'react';

import {
  ApolloClient,
  ApolloProvider as BaseApolloProvider,
  InMemoryCache,
  createHttpLink,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';

import { useAuth } from '@/hooks';

export function ApolloProvider({ children }: { children: ReactNode }) {
  const [{ authToken }] = useAuth();

  const client = useMemo(() => {
    const httpLink = createHttpLink({
      uri: '/api/graphql',
    });

    const authLink = setContext((_, { headers }) => {
      return {
        headers: {
          ...headers,
          authorization: authToken ? `Bearer ${authToken}` : '',
        },
      };
    });

    return new ApolloClient({
      link: authLink.concat(httpLink),
      cache: new InMemoryCache(),
    });
  }, [authToken]);

  return <BaseApolloProvider client={client}>{children}</BaseApolloProvider>;
}
