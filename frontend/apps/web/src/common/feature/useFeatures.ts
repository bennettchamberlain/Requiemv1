import { useCallback, useEffect, useRef, useState } from 'react';

import { createHookContext, fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

type Features = Record<string, boolean>;

type ReturnValue = {
  isFeatureEnabled: (featureName: string) => boolean;
  /**
   * True until both flag sets have been answered for. `isFeatureEnabled` reports
   * *every* flag as disabled before then, which is indistinguishable from a flag
   * that really is off — so anything that would take an irreversible-looking
   * action on "disabled" (rendering a 404, redirecting away) has to wait this out.
   */
  loading: boolean;
  refresh: () => Promise<void>;
};

function useFeatures(): ReturnValue {
  const [{ authToken, initializing }] = useAuth();

  const [features, setFeatures] = useState<Features>({});
  const [globalFeatures, setGlobalFeatures] = useState<Features>({});

  const hasFetched = useRef(false);
  const hasFetchedGlobal = useRef(false);

  // Refs cannot drive a re-render, so `loading` needs its own state. "Settled"
  // means answered, not answered successfully: a failed fetch leaves the flags
  // off, and callers should act on that rather than spin forever.
  const [userSettled, setUserSettled] = useState(false);
  const [globalSettled, setGlobalSettled] = useState(false);

  const fetchFeatures = useCallback(
    async (force = false) => {
      if (!authToken) {
        return;
      }

      if (hasFetched.current && !force) {
        return;
      }

      try {
        const data = await fetchJson<Features>('/api/_internal/features', {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (data) {
          setFeatures(data);
          hasFetched.current = true;
        }
      } catch (err) {
        console.error('Failed to fetch features', err);
      } finally {
        setUserSettled(true);
      }
    },
    [authToken],
  );

  const fetchGlobalFeatures = useCallback(async (force = false) => {
    if (hasFetchedGlobal.current && !force) {
      return;
    }

    try {
      const data = await fetchJson<Features>('/api/_internal/features/global');

      if (data) {
        setGlobalFeatures(data);
        hasFetchedGlobal.current = true;
      }
    } catch (err) {
      console.error('Failed to fetch features', err);
    } finally {
      setGlobalSettled(true);
    }
  }, []);

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  useEffect(() => {
    fetchGlobalFeatures();
  }, [fetchGlobalFeatures]);

  const isFeatureEnabled = useCallback(
    (featureName: string) => {
      if (hasFetched.current && features[featureName] === true) {
        return true;
      }

      if (hasFetchedGlobal.current && globalFeatures[featureName] === true) {
        return true;
      }

      return false;
    },
    [features, globalFeatures],
  );

  // The per-user set needs a token, so "no token" is only an answer once the
  // session handshake has finished — until then one may still arrive. The global
  // set is unauthenticated and always fetched.
  const userPending = initializing || (Boolean(authToken) && !userSettled);

  return {
    isFeatureEnabled,
    loading: userPending || !globalSettled,
    refresh: async () => {
      await Promise.allSettled([fetchFeatures(true), fetchGlobalFeatures(true)]);
    },
  };
}

const { Provider, useHookContext } = createHookContext(useFeatures);

export { Provider as FeaturesProvider, useHookContext as useFeatures };
