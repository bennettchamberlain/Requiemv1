import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSearchParams } from 'react-router-dom';

import { TimelineJsHost } from '@/components/TimelineJs';

import {
  Empty,
  ErrorState,
  MemoryEmptyState,
  TimelineSkeleton,
  getEntityTimestamp,
  isChronologicalSort,
} from '../Components';
import { countActiveFilters } from '../Components/ExplorerToolbar/filterParams';
import { isDimensionActive } from '../Components/ExplorerToolbar/viewFilterSupport';
import { useEntityService } from '../useEntityService';

import {
  buildMemoryTimelineData,
  MEMORY_TIMELINE_BUFFER_FETCH_CAP,
  MEMORY_TIMELINE_FETCH_CAP,
  MEMORY_TIMELINE_FILTERED_FETCH_CAP,
  MEMORY_TIMELINE_MAX_SLIDES,
  shouldPrefetchBuffer,
} from './entitiesToTimeline';

const TITLE_SLIDE_ID = 'memory-title';

export function StoryTimelineView() {
  const [searchParams] = useSearchParams();
  const filteredBrowse = countActiveFilters(searchParams) > 0 || Boolean(searchParams.get('search')?.trim());
  const dateFiltered = isDimensionActive(searchParams, 'date');
  const chronological = isChronologicalSort(
    searchParams.get('sortBy'),
    Boolean(searchParams.get('search')?.trim()),
  );
  const nextPageDirection: 'older' | 'newer' =
    searchParams.get('sortOrder') === 'asc' ? 'newer' : 'older';
  const sessionKey = searchParams.toString();

  const [{ data, loading, loadingMore, hasNextPage, loadMore, error, refetch }] = useEntityService();
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    setFocusId(null);
  }, [sessionKey]);

  const datedCount = useMemo(() => data.filter((entity) => getEntityTimestamp(entity) != null).length, [data]);

  const fetchCap = dateFiltered ? MEMORY_TIMELINE_FILTERED_FETCH_CAP : MEMORY_TIMELINE_FETCH_CAP;

  // Date filter: pull every page in the closed range so the deck can start at
  // the beginning. Unfiltered: fill an initial window around now, then keep a
  // moving buffer as the user walks the axis.
  useEffect(() => {
    if (loading || loadingMore || !hasNextPage) {
      return;
    }

    if (dateFiltered) {
      if (data.length >= fetchCap) {
        return;
      }

      loadMore();
      return;
    }

    if (datedCount >= MEMORY_TIMELINE_MAX_SLIDES || data.length >= fetchCap) {
      return;
    }

    loadMore();
  }, [data.length, dateFiltered, datedCount, fetchCap, hasNextPage, loadMore, loading, loadingMore]);

  const {
    data: deck,
    startAtSlide,
    datedCount: datedInDeck,
    focusIndex,
  } = useMemo(
    () =>
      buildMemoryTimelineData(data, new Date(), {
        anchor: dateFiltered ? 'range-start' : 'now',
        focusId: dateFiltered ? null : focusId,
      }),
    [data, dateFiltered, focusId],
  );

  const filling = dateFiltered
    ? (loading && data.length === 0) || (hasNextPage && data.length < fetchCap)
    : (loading && data.length === 0) ||
      (hasNextPage && datedCount < MEMORY_TIMELINE_MAX_SLIDES && data.length < fetchCap);

  useEffect(() => {
    if (dateFiltered || filling || !chronological) {
      return;
    }

    if (loading || loadingMore || !hasNextPage) {
      return;
    }

    if (data.length >= MEMORY_TIMELINE_BUFFER_FETCH_CAP) {
      return;
    }

    if (
      shouldPrefetchBuffer({
        focusIndex,
        datedCount: datedInDeck,
        hasNextPage,
        nextPageDirection,
      })
    ) {
      loadMore();
    }
  }, [
    chronological,
    data.length,
    dateFiltered,
    datedInDeck,
    filling,
    focusIndex,
    hasNextPage,
    loadMore,
    loading,
    loadingMore,
    nextPageDirection,
  ]);

  const handleSlideChange = useCallback(
    (uniqueId: string) => {
      if (uniqueId === TITLE_SLIDE_ID || uniqueId === deck.title.unique_id) {
        const first = deck.events[0]?.unique_id;
        if (first) {
          setFocusId(first);
        }

        return;
      }

      setFocusId(uniqueId);
    },
    [deck.events, deck.title.unique_id],
  );

  if (filling) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <TimelineSkeleton count={5} />
      </div>
    );
  }

  if (error && data.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <ErrorState onRetry={refetch} />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <MemoryEmptyState filtered={filteredBrowse} />
      </div>
    );
  }

  if (deck.events.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <Empty
          title="No dated memories match this search"
          description="These results aren't time-based. Switch to List to see them."
          icon="🗂️"
        />
      </div>
    );
  }

  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-card/40 px-2 pb-2 min-h-[480px]"
      data-testid="memory-timeline"
    >
      <TimelineJsHost
        data={deck}
        startAtSlide={startAtSlide}
        sessionKey={sessionKey}
        onSlideChange={handleSlideChange}
      />
    </div>
  );
}
