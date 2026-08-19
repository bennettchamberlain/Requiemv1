import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

import { rangeToBounds, type StatsRange } from './statsRange';

/** Mirrors `EntitySourceKind` in the API's GraphUtilityService. */
export type EntitySourceKind = 'self' | 'imported' | 'derived' | 'unknown';

export interface SourceCount {
  /** Raw provenance key — map it through `sourceLabel` before displaying. */
  readonly source: string;
  readonly kind: EntitySourceKind;
  readonly count: number;
}

export interface TagCount {
  readonly label: string;
  readonly count: number;
}

export interface TypeCount {
  readonly type: string;
  readonly count: number;
}

export interface SpendRow {
  readonly merchant: string;
  readonly count: number;
  readonly totalMinor: number;
  readonly avgMinor: number;
  readonly currency: string;
  readonly sources: readonly string[];
}

export interface TimeRow {
  readonly bucket: string;
  readonly label: string;
  readonly minutes: number;
  readonly count: number;
}

export interface TimeSeries {
  readonly mode: 'hours' | 'counts';
  readonly coverage: { readonly timedEvents: number; readonly consideredEvents: number };
  readonly rows: readonly TimeRow[];
}

export interface ConversationRow {
  readonly personId: string;
  readonly name: string;
  readonly count: number;
  readonly inbound: number;
  readonly outbound: number;
  readonly lastAt: string | null;
}

export interface SocialRow {
  readonly bucket: string;
  readonly sourceSystem: string;
  readonly kind: string;
  readonly count: number;
}

export interface ChannelRow {
  readonly source: string;
  readonly count: number;
}

export interface LifeInsight {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly href?: string;
}

export interface MemoryStats {
  readonly totals: {
    readonly events: number;
    readonly entities: number;
    readonly relationships: number;
  };
  readonly dateRange: {
    readonly earliest: string | null;
    readonly latest: string | null;
  };
  readonly bySource: readonly SourceCount[];
  readonly byTag: readonly TagCount[];
  readonly byEntityType: readonly TypeCount[];
  readonly byRelationshipType: readonly TypeCount[];
  readonly spend: { readonly rows: readonly SpendRow[] };
  readonly time: TimeSeries;
  readonly conversations: { readonly rows: readonly ConversationRow[] };
  readonly social: { readonly granularity: 'week' | 'month'; readonly rows: readonly SocialRow[] };
  readonly channels: { readonly rows: readonly ChannelRow[] };
  readonly insights: readonly LifeInsight[];
}

interface MemoryStatsResponse {
  readonly success: boolean;
  readonly data: MemoryStats;
}

export function useStatsService(range: StatsRange) {
  const [data, setData] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [{ authToken }] = useAuth();

  const load = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const bounds = rangeToBounds(range);
      const params = new URLSearchParams();
      if (bounds.from) {
        params.set('from', bounds.from);
      }

      if (bounds.to) {
        params.set('to', bounds.to);
      }

      const query = params.toString();
      const response = await fetchJson<MemoryStatsResponse>(`/api/graph/stats${query ? `?${query}` : ''}`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (!response?.success) {
        throw new Error('Stats request failed');
      }

      setData(response.data);
      setLoading(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  }, [authToken, range]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    data,
    loading,
    error,
    refresh: load,
  } as const;
}
