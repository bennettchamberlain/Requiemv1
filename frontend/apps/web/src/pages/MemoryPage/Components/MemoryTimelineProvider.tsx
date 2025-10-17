import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';

import { useAuth } from '@/hooks';

import type { MemoryItem } from './types';

interface MemoryTimelineContextValue {
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

const MemoryTimelineContext = createContext<MemoryTimelineContextValue | null>(null);

export function useMemoryTimeline() {
  const context = useContext(MemoryTimelineContext);
  if (!context) {
    throw new Error('useMemoryTimeline must be used within a MemoryTimelineProvider');
  }

  return context;
}

interface MemoryTimelineProviderProps {
  children: React.ReactNode;
}

export function MemoryTimelineProvider({ children }: MemoryTimelineProviderProps) {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMorePast, setHasMorePast] = useState(true);
  const [hasMoreFuture, setHasMoreFuture] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Track loading states separately for past and future
  const [loadingPast, setLoadingPast] = useState(false);
  const [loadingFuture, setLoadingFuture] = useState(false);

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
      query: string = '',
      offset: number = 0,
      limit: number = 500,
      direction: 'past' | 'future' | 'initial' = 'initial',
    ) => {
      try {
        if (!authToken) {
          throw new Error('No authentication token available');
        }

        const params = new URLSearchParams();
        if (query) {
          params.append('search', query);
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
          // For initial load, get events around current time
          const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          const oneMonthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          params.append('startDate', oneMonthAgo.toISOString());
          params.append('endDate', oneMonthFromNow.toISOString());
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
          if (memory.type !== 'event' && memory.type !== 'communication') {
            return false;
          }

          if (
            memory.category === 'Google Drive' ||
            memory.category === 'Drive' ||
            memory.category?.toLowerCase().includes('drive') ||
            memory.category?.toLowerCase().includes('google drive') ||
            memory.metadata?.source === 'Google Drive' ||
            memory.metadata?.source?.toLowerCase().includes('drive')
          ) {
            return false;
          }

          return true;
        });

        const total = result.total || data.length;

        return { data, total };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        throw new Error(errorMessage);
      }
    },
    [authToken],
  );

  // Load initial memories around current date
  const loadInitialMemories = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { data, total } = await fetchMemories(searchQuery, 0, MAX_MEMORIES, 'initial');

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
  }, [searchQuery, fetchMemories]);

  // Load past events (for scrolling up)
  const loadPastEvents = useCallback(async () => {
    if (loadingPast || !hasMorePast) {
      return;
    }

    setLoadingPast(true);
    try {
      const { data } = await fetchMemories(searchQuery, 0, LOAD_BATCH_SIZE, 'past');

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
  }, [searchQuery, fetchMemories, loadingPast, hasMorePast, memories]);

  const loadFutureEvents = useCallback(async () => {
    if (loadingFuture || !hasMoreFuture) {
      return;
    }

    setLoadingFuture(true);
    try {
      const { data } = await fetchMemories(searchQuery, 0, LOAD_BATCH_SIZE, 'future');

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
  }, [searchQuery, fetchMemories, loadingFuture, hasMoreFuture, memories]);

  // Refresh timeline
  const refreshTimeline = useCallback(async () => {
    setMemories([]);
    pastOffsetRef.current = 0;
    futureOffsetRef.current = 0;
    setHasMorePast(true);
    setHasMoreFuture(true);
    await loadInitialMemories();
  }, [loadInitialMemories]);

  // Load initial memories when component mounts or search query changes
  useEffect(() => {
    loadInitialMemories();
  }, [loadInitialMemories]);

  const value: MemoryTimelineContextValue = {
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

  return <MemoryTimelineContext.Provider value={value}>{children}</MemoryTimelineContext.Provider>;
}
