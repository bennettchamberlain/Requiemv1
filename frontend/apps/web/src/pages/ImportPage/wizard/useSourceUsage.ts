import { useEffect, useState } from 'react';

import { useImportApi, type CatalogSource } from '../useImportApi';

/**
 * How many runs the roll-up reads.
 *
 * `GET /import/runs` caps at 200 and defaults to 50. Asking for the cap is not
 * the same as asking for all of them, which is exactly why this hook reports
 * only a DATE and never a total: a date computed from the newest 200 runs is
 * still the right date, where a sum would silently be a sum of the newest 200.
 */
const RUN_PAGE = 200;

/**
 * When each importer last put something in your memory, keyed by importer name.
 *
 * Deliberately a date and nothing else. The obvious next field — how many
 * records this source contributed — cannot be computed from run data without
 * lying:
 *
 *  - a run records ONE total for the whole archive, so a Google Takeout
 *    containing mail, photos and browser history would have to credit its full
 *    total to each of the three;
 *  - a bundle tile covers several importers, so those already-whole totals
 *    would then be summed again;
 *  - runs are not idempotent, so re-importing the same archive would double a
 *    figure whose rows were deduplicated away.
 *
 * A run's yield is true of the RUN, so that is where it is shown — on the run,
 * under History.
 *
 * `partial` counts as imported. It is a terminal success state, set whenever a
 * single row failed to push or one entity was skipped — routine for a real
 * multi-source archive — and treating it as "never imported" would tell most
 * people their completed import never happened.
 */
export function useSourceUsage(): ReadonlyMap<string, string> {
  const api = useImportApi();
  const [lastImportedAt, setLastImportedAt] = useState<ReadonlyMap<string, string>>(new Map());

  useEffect(() => {
    if (!api.ready) {
      return;
    }

    let cancelled = false;

    void api
      .listRuns(RUN_PAGE)
      .then((runs) => {
        if (cancelled) {
          return;
        }

        const next = new Map<string, string>();

        for (const run of runs) {
          if ((run.status !== 'completed' && run.status !== 'partial') || run.finishedAt == null) {
            continue;
          }

          for (const source of run.dataSources) {
            const previous = next.get(source);

            if (previous == null || run.finishedAt > previous) {
              next.set(source, run.finishedAt);
            }
          }
        }

        setLastImportedAt(next);
      })
      .catch(() => {
        // No line at all is the honest fallback for "could not ask". A blank
        // would read as "you have never imported this".
        if (!cancelled) {
          setLastImportedAt(new Map());
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  return lastImportedAt;
}

/**
 * Importer names that belong to exactly ONE catalog source.
 *
 * A run records which IMPORTERS it fed, not which catalog entries the user
 * picked, and thirteen catalog sources share four parsers between them —
 * `calendar` covers Google, Apple and Outlook calendars; `vcard` covers two
 * contact exports; `email` covers Outlook and Yahoo mail; `generic` covers
 * OneDrive, Dropbox, Backblaze and more. Marking an Apple Calendar tile
 * "imported" because a Google Calendar was is a claim about the wrong service,
 * so a shared importer credits none of its sources.
 */
export function unambiguousImporters(catalog: readonly CatalogSource[]): ReadonlySet<string> {
  const owners = new Map<string, number>();

  for (const source of catalog) {
    owners.set(source.importer, (owners.get(source.importer) ?? 0) + 1);
  }

  return new Set([...owners].filter(([, count]) => count === 1).map(([importer]) => importer));
}
