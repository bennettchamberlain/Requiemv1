import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import {
  ApolloClient,
  ApolloProvider as BaseApolloProvider,
  InMemoryCache,
  createHttpLink,
} from '@apollo/client';
import { setContext } from '@apollo/client/link/context';

import introspectionResult from '@/graphql/possibleTypes';
import { useAuth } from '@/hooks';

export function ApolloProvider({ children }: { children: ReactNode }) {
  const [{ authToken }] = useAuth();

  const tokenRef = useRef(authToken);

  useEffect(() => {
    tokenRef.current = authToken;
  }, [authToken]);

  const client = useMemo(() => {
    const httpLink = createHttpLink({
      uri: '/api/graphql',
    });

    const authLink = setContext((_, { headers }) => {
      return {
        headers: {
          ...headers,
          authorization: tokenRef.current ? `Bearer ${tokenRef.current}` : '',
        },
      };
    });

    return new ApolloClient({
      link: authLink.concat(httpLink),
      cache: new InMemoryCache({
        possibleTypes: introspectionResult.possibleTypes,
      }),
    });
  }, []);

  return <BaseApolloProvider client={client}>{children}</BaseApolloProvider>;
}
