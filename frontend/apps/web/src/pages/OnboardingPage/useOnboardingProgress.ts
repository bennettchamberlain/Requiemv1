import { useCallback, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

import type { OnboardingStepKey } from './constants';

export interface OnboardingProgress {
  stepKey: OnboardingStepKey;
  draft: Record<string, unknown>;
  updatedAt: string | null;
}

export function useOnboardingProgress() {
  const [{ authToken }] = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const fetchProgress = useCallback(async (): Promise<OnboardingProgress | null> => {
    if (!authToken) {
      setLoading(false);

      return null;
    }

    setLoading(true);
    setError(null);

    try {
      const progress = await fetchJson<OnboardingProgress>('/api/onboarding/progress', {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      return progress ?? null;
    } catch (err) {
      setError(err);

      return null;
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  const saveProgress = useCallback(
    async (stepKey: OnboardingStepKey, draft: Record<string, unknown>) => {
      if (!authToken) {
        return;
      }

      await fetchJson<OnboardingProgress>('/api/onboarding/progress', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ stepKey, draft }),
      });
    },
    [authToken],
  );

  return {
    loading,
    error,
    fetchProgress,
    saveProgress,
  };
}
