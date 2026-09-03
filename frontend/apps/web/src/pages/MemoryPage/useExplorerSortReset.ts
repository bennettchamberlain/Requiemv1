import { useEffect } from 'react';

import { useLocation, useSearchParams } from 'react-router-dom';

import { hasWhenFilter } from './Components/ExplorerToolbar/filterParams';
import { isEverythingExplorer } from './explorerRoute';

/**
 * On the everything browse (`/memory`), a time sort only makes sense inside a
 * When filter — Newest / Oldest are offered there and nowhere else (see
 * explorerSortOptions). When the When filter is removed, by whichever of the
 * several affordances that clear it (the chip, the popover, the heatmap, Clear
 * all, a deep link that never had one), the sort falls back to relevance.
 *
 * Returns true while the URL still carries the stale time sort, so the caller
 * can already leave it out of the request it is about to send instead of
 * fetching one time-ordered page and then re-fetching.
 */
export function useExplorerSortReset(): boolean {
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const stale =
    isEverythingExplorer(pathname) && !hasWhenFilter(searchParams) && searchParams.get('sortBy') === 'time';

  useEffect(() => {
    if (!stale) {
      return;
    }

    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params);
        next.delete('sortBy');
        next.delete('sortOrder');

        return next;
      },
      { replace: true },
    );
  }, [stale, setSearchParams]);

  return stale;
}
