import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from './useAuth';

export type LlmBackendKind = 'ollama' | 'openai_compatible';

export interface LlmEndpointConfig {
  backend: LlmBackendKind;
  port: number;
  apiKey?: string;
  hostGateway: string;
  locked: boolean;
}

export function useLlmEndpoint() {
  const [{ authToken, expired }] = useAuth();
  const [config, setConfig] = useState<LlmEndpointConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchEndpoint = useCallback(async () => {
    if (authToken == null || expired) {
      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await fetchJson<LlmEndpointConfig>('/api/llm/endpoint', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (data) {
        setConfig(data);
      }

      return data ?? null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load LLM endpoint settings.');

      return null;
    } finally {
      setLoading(false);
    }
  }, [authToken, expired]);

  const saveEndpoint = useCallback(
    async (next: Pick<LlmEndpointConfig, 'backend' | 'port' | 'apiKey'>) => {
      if (authToken == null || expired) {
        return null;
      }

      setSaving(true);
      setError(null);

      try {
        const data = await fetchJson<LlmEndpointConfig>('/api/llm/endpoint', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(next),
        });

        if (data) {
          setConfig(data);
        }

        return data ?? null;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save LLM endpoint settings.');

        return null;
      } finally {
        setSaving(false);
      }
    },
    [authToken, expired],
  );

  useEffect(() => {
    void fetchEndpoint();
  }, [fetchEndpoint]);

  return {
    config,
    loading,
    saving,
    error,
    fetchEndpoint,
    saveEndpoint,
  };
}
