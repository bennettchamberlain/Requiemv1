import { useEffect, useState } from 'react';

import { useImportApi } from '../useImportApi';

export interface SourceUsage {
  /** Records this source has pushed into `ci.*`, across every run. */
  readonly records: number;
  /** ISO timestamp of the most recent finished run that included it. */
  readonly lastImportedAt: string | null;
}

/**
 * What each source has already given this appliance, keyed by importer name.
 *
 * A run's `dataSources` is what the parse stage actually found inside the
 * archive, so one Google Takeout credits Gmail, Photos and Chrome — which is
 * the honest answer to "have I imported this before", and the reason this is
 * derived from runs rather than from what someone once picked in the wizard.
 *
 * The records figure is the run's total, attributed to every source it
 * contained. A per-source split is not something the push stage records, and
 * inventing one would be worse than a number the tile can stand behind: "this
 * import brought in 42,318 records, and your Gmail was part of it".
 */
export function useSourceUsage(): ReadonlyMap<string, SourceUsage> {
  const api = useImportApi();
  const [usage, setUsage] = useState<ReadonlyMap<string, SourceUsage>>(new Map());

  useEffect(() => {
    if (!api.ready) {
      return;
    }

    let cancelled = false;

    void api
      .listRuns()
      .then((runs) => {
        if (cancelled) {
          return;
        }

        const next = new Map<string, SourceUsage>();

        for (const run of runs) {
          // Only finished runs count. A running import has pushed nothing yet,
          // and a failed one should not leave a card claiming it is in use.
          if (run.status !== 'completed' || run.finishedAt == null) {
            continue;
          }

          for (const source of run.dataSources) {
            const previous = next.get(source);

            next.set(source, {
              records: (previous?.records ?? 0) + (run.records ?? 0),
              lastImportedAt:
                previous?.lastImportedAt != null && previous.lastImportedAt > run.finishedAt
                  ? previous.lastImportedAt
                  : run.finishedAt,
            });
          }
        }

        setUsage(next);
      })
      .catch(() => {
        // A card with no usage line is the honest fallback for "could not ask";
        // a zero would read as "you have never imported this".
        if (!cancelled) {
          setUsage(new Map());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  return usage;
}
