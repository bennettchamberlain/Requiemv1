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
    endpoints: string[];
    setEndpoints: (endpoints: string[]) => void;
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
  const [endpoints, setEndpoints] = useState<string[]>([]);

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
          body: JSON.stringify({ endpoints: endpoints || [] }),
        });

        setAuthorizationUrl(response.authorizationUrl);
      } catch (err: unknown) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [authToken, endpoints],
  );

  return [
    {
      authorizationUrl,
      loading,
      error,
      endpoints,
      setEndpoints,
    },
    {
      connect,
    },
  ];
}
