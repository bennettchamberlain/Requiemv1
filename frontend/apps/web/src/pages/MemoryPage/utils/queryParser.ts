import { useMemo } from 'react';

import { useSearchParams } from 'react-router-dom';

import type { MemoryQuery } from '../MemoryProvider';

export function useMemoryQuery(): MemoryQuery {
  const [searchParams] = useSearchParams();

  return useMemo(() => {
    const search = searchParams.get('search') || undefined;
    const category = searchParams.get('category') || undefined;
    const entityTypes = searchParams.get('entityTypes')?.split(',').filter(Boolean) || undefined;

    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    const dateRange =
      startDate || endDate
        ? {
            start: startDate,
            end: endDate,
          }
        : undefined;

    const excludedEntityTypes =
      searchParams.get('excludedEntityTypes')?.split(',').filter(Boolean) || undefined;

    const query = {
      search,
      category,
      dateRange,
      entityTypes,
      excludedEntityTypes,
    };

    return query;
  }, [searchParams]);
}
