import { useEffect, useState } from 'react';

import { useQuery } from '@apollo/client';

import { useFeatures } from '@/common/feature';
import { GET_CONNECTIONS } from '@/components/connect/ConnectedAccountsSection';
import { useImportApi } from '@/pages/ImportPage/useImportApi';

export interface SourceCounts {
  readonly connections: number;
  readonly imports: number;
  /**
   * Nothing has ever fed this appliance — no connection, no import run.
   *
   * Deliberately false until both counts have actually come back. A page that
   * renders its first-run state during the first paint and then swaps it for a
   * populated one flashes "you have nothing" at someone who has plenty.
   */
  readonly isFirstRun: boolean;
  readonly loading: boolean;
}

/**
 * How much data is already coming in, for the two path tiles to report.
 *
 * The two halves of the page answer to two different backends — connections
 * are GraphQL, import runs are the REST import API (`GET /import/runs`; the API
 * has no global prefix, and the hook's own `/api` is stripped by the dev
 * proxy) — so the counts are gathered here rather than in either half.
 */
export function useSourceCounts(): SourceCounts {
  const { isFeatureEnabled } = useFeatures();
  const importEnabled = isFeatureEnabled('import.page');

  const api = useImportApi();
  const { data, loading: connectionsLoading } = useQuery(GET_CONNECTIONS);

  const [imports, setImports] = useState<number | null>(null);

  useEffect(() => {
    if (!importEnabled) {
      setImports(0);

      return;
    }

    if (!api.ready) {
      return;
    }

    let cancelled = false;

    void api
      .listRuns()
      .then((runs) => {
        if (!cancelled) {
          setImports(runs.length);
        }
      })
      .catch(() => {
        // An unreachable import API is not evidence that nothing was ever
        // imported, so this stays `null` and `isFirstRun` stays false: the
        // page shows its compact form rather than telling someone with a
        // decade of Takeout that they have nothing.
        if (!cancelled) {
          setImports(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api, importEnabled]);

  const connections = data?.connections.totalCount ?? 0;
  const loading = connectionsLoading || imports === null;

  return {
    connections,
    imports: imports ?? 0,
    isFirstRun: !loading && connections === 0 && imports === 0,
    loading,
  };
}
