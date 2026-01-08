import { useCallback, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

interface ConnectResponse {
  authorizationUrl: string;
}

type ReturnType = [
  {
    authorizationUrl: string | null;
    loading: boolean;
    error: unknown | null;
    scopes: string[];
    setScopes: (scopes: string[]) => void;
  },
  {
    connect: (providerId: string) => Promise<void>;
  },
];

export function useConnectService(): ReturnType {
  const [{ authToken }] = useAuth();

  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<unknown | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);

  const connect = useCallback(
    async (providerId: string) => {
      setAuthorizationUrl(null);
      setLoading(true);
      setError(null);

      try {
        const response = await fetchJson<ConnectResponse>(`/api/providers/${providerId}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ scopes: scopes || [] }),
        });

        setAuthorizationUrl(response.authorizationUrl);
      } catch (err: unknown) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [authToken, scopes],
  );

  return [
    {
      authorizationUrl,
      loading,
      error,
      scopes,
      setScopes,
    },
    {
      connect,
    },
  ];
}
