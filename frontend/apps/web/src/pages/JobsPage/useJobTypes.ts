import { useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

export interface JobTypeDescriptor {
  readonly label: string;
  readonly category: string;
  readonly description: string;
  readonly interactive: boolean;
}

export interface JobTypesResponse {
  readonly categories: readonly string[];
  readonly types: Readonly<Record<string, JobTypeDescriptor>>;
}

/**
 * The job taxonomy — every event the appliance can emit, with its label and
 * category.
 *
 * Served rather than duplicated in the frontend so the type filter offers
 * exactly what the backend can classify: an event that gains a listener without
 * gaining a taxonomy entry shows up here as missing, instead of silently looking
 * like everything else. Fetched once; the taxonomy is static for a given build.
 */
export function useJobTypes(): { types: JobTypesResponse | null; loading: boolean } {
  const [{ authToken }] = useAuth();
  const [types, setTypes] = useState<JobTypesResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!authToken) {
      return;
    }

    fetchJson<JobTypesResponse>('/api/jobs/types', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then((response) => {
        if (!cancelled) {
          setTypes(response ?? null);
        }
      })
      .catch(() => {
        // A missing taxonomy must not break the table — the filter simply
        // offers nothing rather than the page failing to render.
        if (!cancelled) {
          setTypes(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  return { types, loading };
}
