import { useCallback, useEffect, useRef, useState } from 'react';

import { createHookContext, fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

type Features = Record<string, boolean>;

type ReturnValue = {
  isFeatureEnabled: (featureName: string) => boolean;
  refresh: () => Promise<void>;
};

function useFeatures(): ReturnValue {
  const [{ authToken }] = useAuth();

  const [features, setFeatures] = useState<Features>({});

  const hasFetched = useRef(false);

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

        setFeatures(data);

        hasFetched.current = true;
      } catch (err) {
        console.error('Failed to fetch features', err);
      }
    },
    [authToken],
  );

  useEffect(() => {
    fetchFeatures();
  }, [fetchFeatures]);

  const isFeatureEnabled = useCallback(
    (featureName: string) => {
      return !!features[featureName];
    },
    [features],
  );

  return {
    isFeatureEnabled,
    refresh: () => fetchFeatures(true),
  };
}

const { Provider, useHookContext } = createHookContext(useFeatures);

export { Provider as FeaturesProvider, useHookContext as useFeatures };
