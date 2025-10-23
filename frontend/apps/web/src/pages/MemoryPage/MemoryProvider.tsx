import { useState, useCallback, useRef, useEffect } from 'react';

import { createHookContext } from '@ci/common';

import { useAuth } from '@/hooks';

import type { MemoryItem } from './Components/types';

export interface MemoryQuery {
  search?: string;
  category?: string;
  dateRange?: {
    start?: string;
    end?: string;
  };
  entityTypes?: string[];
}

interface MemoryContextValue {
  memories: MemoryItem[];
  loading: boolean;
  error: string | null;
  hasMorePast: boolean;
  hasMoreFuture: boolean;
  loadPastEvents: () => Promise<void>;
  loadFutureEvents: () => Promise<void>;
  refreshTimeline: () => Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  loadingPast: boolean;
  loadingFuture: boolean;
}

// Create the hook that will be used by the context
function useMemoryHook(query: MemoryQuery = {}): MemoryContextValue {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMorePast, setHasMorePast] = useState(true);
  const [hasMoreFuture, setHasMoreFuture] = useState(true);
  const [searchQuery, setSearchQuery] = useState(query.search || '');

  // Use query.search as the source of truth for search
  const currentSearchQuery = query.search || searchQuery;

  // Track loading states separately for past and future
  const [loadingPast, setLoadingPast] = useState(false);
  const [loadingFuture, setLoadingFuture] = useState(false);

  // Debounced search effect to prevent API calls on every keystroke
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(currentSearchQuery);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedSearchQuery(currentSearchQuery);
    }, 300); // 300ms debounce

    return () => clearTimeout(timeoutId);
  }, [currentSearchQuery]);

  // Track offsets for past and future loading
  const pastOffsetRef = useRef(0);
  const futureOffsetRef = useRef(0);
  const totalCountRef = useRef(0);

  // Maximum number of memories to keep in memory at once (sliding window)
  const MAX_MEMORIES = 500;
  const LOAD_BATCH_SIZE = 200;
  const OFFLOAD_THRESHOLD = MAX_MEMORIES; // Start offloading when we hit max

  // Get auth token from useAuth hook
  const [{ authToken }] = useAuth();

  // Fetch memories from API
  const fetchMemories = useCallback(
    async (
      searchQuery: string = '',
      offset: number = 0,
      limit: number = 500,
      direction: 'past' | 'future' | 'initial' = 'initial',
    ) => {
      console.log('MemoryProvider: fetchMemories called with', { searchQuery, offset, limit, direction });
      try {
        if (!authToken) {
          throw new Error('No authentication token available');
        }

        const params = new URLSearchParams();
        if (searchQuery) {
          params.append('search', searchQuery);
        }

        // Add query parameters from the hook argument
        if (query.search) {
          params.append('search', query.search);
        }

        if (query.category) {
          params.append('category', query.category);
        }

        if (query.entityTypes && query.entityTypes.length > 0) {
          params.append('entityTypes', query.entityTypes.join(','));
        }

        params.append('limit', limit.toString());
        params.append('offset', offset.toString());

        // Exclude Google Drive categories
        params.append('excludeCategories', 'Google Drive,Drive');

        // Add date filters based on direction
        const now = new Date();
        if (direction === 'past') {
          // For past events, get events before the oldest current event
          const oldestMemory = memories.reduce((oldest, memory) => {
            const memoryDate = new Date(memory.timestamp);
            const oldestDate = new Date(oldest.timestamp);

            return memoryDate < oldestDate ? memory : oldest;
          }, memories[0]);

          if (oldestMemory) {
            params.append('endDate', oldestMemory.timestamp);
          }
        } else if (direction === 'future') {
          // For future events, get events after the newest current event
          const newestMemory = memories.reduce((newest, memory) => {
            const memoryDate = new Date(memory.timestamp);
            const newestDate = new Date(newest.timestamp);

            return memoryDate > newestDate ? memory : newest;
          }, memories[0]);

          if (newestMemory) {
            params.append('startDate', newestMemory.timestamp);
          }
        } else {
          // For initial load, use query date range or default to around current time
          if (query.dateRange?.start) {
            params.append('startDate', query.dateRange.start);
          } else {
            const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            params.append('startDate', oneMonthAgo.toISOString());
          }

          if (query.dateRange?.end) {
            params.append('endDate', query.dateRange.end);
          } else {
            const oneMonthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
            params.append('endDate', oneMonthFromNow.toISOString());
          }
        }

        const url = `/api/memory${params.toString() ? `?${params.toString()}` : ''}`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        });

        if (!response.ok) {
          throw new Error(`Failed to fetch memories: ${response.statusText}`);
        }

        const result = await response.json();
        const rawData: MemoryItem[] = result.data || result;

        const data = rawData.filter((memory) => {
          // Check if this is a specific entity type we want to include
          const entityType = memory.metadata?.entityType as string | undefined;
          const isTargetEntity =
            entityType && ['Person', 'Video', 'File', 'Channel', 'Document'].includes(entityType);

          // Always include our target entity types
          if (isTargetEntity) {
            return true;
          }

          // For events and communications, check if they should be included
          if (memory.type === 'event' || memory.type === 'communication') {
            // Filter out Google Drive items for events/communications only
            const isDriveItem =
              memory.category === 'Google Drive' ||
              memory.category === 'Drive' ||
              (memory.category?.toLowerCase().includes('drive') &&
                memory.category?.toLowerCase().includes('google')) ||
              memory.metadata?.source === 'Google Drive' ||
              (memory.metadata?.source &&
                typeof memory.metadata.source === 'string' &&
                memory.metadata.source.toLowerCase().includes('google') &&
                memory.metadata.source.toLowerCase().includes('drive'));

            if (isDriveItem) {
              return false;
            }

            return true;
          }

          // Filter out any other types we don't want
          return false;
        });

        const total = result.total || data.length;

        return { data, total };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        throw new Error(errorMessage);
      }
    },
    [authToken, query],
  );

  // Load initial memories around current date
  const loadInitialMemories = useCallback(async () => {
    console.log('MemoryProvider: loadInitialMemories callback created/recreated');
    setLoading(true);
    setError(null);

    try {
      const { data, total } = await fetchMemories(debouncedSearchQuery, 0, MAX_MEMORIES, 'initial');

      setMemories(data);
      totalCountRef.current = total;

      pastOffsetRef.current = 0;
      futureOffsetRef.current = data.length;

      setHasMorePast(true);
      setHasMoreFuture(true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(errorMessage);
      setMemories([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchQuery, fetchMemories]);

  // Load past events (for scrolling up)
  const loadPastEvents = useCallback(async () => {
    if (loadingPast || !hasMorePast) {
      return;
    }

    setLoadingPast(true);
    try {
      const { data } = await fetchMemories(debouncedSearchQuery, 0, LOAD_BATCH_SIZE, 'past');

      if (data.length > 0) {
        setMemories((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newEvents = data.filter((event) => !existingIds.has(event.id));

          let updatedMemories = [...newEvents, ...prev];

          if (updatedMemories.length > OFFLOAD_THRESHOLD) {
            updatedMemories = updatedMemories.slice(0, MAX_MEMORIES);
            setHasMoreFuture(true);
          }

          return updatedMemories;
        });

        pastOffsetRef.current += data.length;
        setHasMorePast(data.length === LOAD_BATCH_SIZE);
      } else {
        setHasMorePast(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoadingPast(false);
    }
  }, [debouncedSearchQuery, fetchMemories, loadingPast, hasMorePast]);

  const loadFutureEvents = useCallback(async () => {
    if (loadingFuture || !hasMoreFuture) {
      return;
    }

    setLoadingFuture(true);
    try {
      const { data } = await fetchMemories(debouncedSearchQuery, 0, LOAD_BATCH_SIZE, 'future');

      if (data.length > 0) {
        setMemories((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newEvents = data.filter((event) => !existingIds.has(event.id));

          let updatedMemories = [...prev, ...newEvents];

          if (updatedMemories.length > OFFLOAD_THRESHOLD) {
            updatedMemories = updatedMemories.slice(updatedMemories.length - MAX_MEMORIES);
            setHasMorePast(true);
          }

          return updatedMemories;
        });

        futureOffsetRef.current += data.length;
        setHasMoreFuture(data.length === LOAD_BATCH_SIZE);
      } else {
        setHasMoreFuture(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoadingFuture(false);
    }
  }, [debouncedSearchQuery, fetchMemories, loadingFuture, hasMoreFuture]);

  // Refresh timeline
  const refreshTimeline = useCallback(async () => {
    setMemories([]);
    pastOffsetRef.current = 0;
    futureOffsetRef.current = 0;
    setHasMorePast(true);
    setHasMoreFuture(true);
    await loadInitialMemories();
  }, [loadInitialMemories]);

  // Load initial memories when component mounts or debounced search query changes
  useEffect(() => {
    console.log('MemoryProvider: useEffect triggered for loadInitialMemories');
    loadInitialMemories();
  }, [loadInitialMemories]);

  return {
    memories,
    loading,
    error,
    hasMorePast,
    hasMoreFuture,
    loadPastEvents,
    loadFutureEvents,
    refreshTimeline,
    searchQuery,
    setSearchQuery,
    loadingPast,
    loadingFuture,
  };
}

// Create the context using createHookContext
export const { Provider: MemoryProvider, useHookContext: useMemory } = createHookContext(
  useMemoryHook,
  'MemoryProvider',
);

// Export the hook with the original name for backward compatibility
export const useMemoryTimeline = useMemory;
