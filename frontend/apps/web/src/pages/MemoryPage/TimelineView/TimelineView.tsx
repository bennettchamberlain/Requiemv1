import { useEffect, useRef } from 'react';

import { Empty, MemoryCard } from '../Components';
import { sortMemoriesByTime, groupMemoriesByDate, formatDateForDisplay } from '../Components/utils';
import { useMemoryService } from '../useMemoryService';

export function TimelineView() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const {
    memories,
    loading,
    hasMorePast,
    hasMoreFuture,
    loadPastEvents,
    loadFutureEvents,
    loadingPast,
    loadingFuture,
  } = useMemoryService();

  const sortedMemories = sortMemoriesByTime(memories);
  const groupedMemories = groupMemoriesByDate(sortedMemories);

  useEffect(() => {
    if (!scrollContainerRef.current) {
      scrollContainerRef.current = timelineRef.current?.closest(
        '[data-slot="scroll-area-viewport"]',
      ) as HTMLDivElement | null;
    }
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (container && sortedMemories.length > 0) {
      setTimeout(() => {
        const currentTimeElement = container.querySelector('[data-current-time="true"]');

        if (currentTimeElement) {
          currentTimeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          container.scrollTop = container.scrollHeight / 2;
        }
      }, 200);
    }
  }, [sortedMemories.length]);

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (container && memories.length > 0) {
      const currentScrollTop = container.scrollTop;
      const currentScrollHeight = container.scrollHeight;

      if (currentScrollTop < 200 && memories.length > 100) {
        const heightDifference = container.scrollHeight - currentScrollHeight;
        if (heightDifference > 0) {
          container.scrollTop = currentScrollTop + heightDifference;
        }
      }
    }
  }, [memories.length]);

  useEffect(() => {
    const container = scrollContainerRef.current;

    if (!container) {
      return;
    }

    let scrollTimeout: NodeJS.Timeout;

    const handleScroll = () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        if (loading || loadingPast || loadingFuture) {
          return;
        }

        const { scrollTop, scrollHeight, clientHeight } = container;

        if (scrollTop < 100 && hasMorePast && !loadingPast) {
          loadPastEvents();
        }

        if (scrollTop + clientHeight > scrollHeight - 100 && hasMoreFuture && !loadingFuture) {
          loadFutureEvents();
        }
      }, 50);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [loading, loadingPast, loadingFuture, hasMorePast, hasMoreFuture, loadPastEvents, loadFutureEvents]);

  if (memories.length === 0 && !loading) {
    return (
      <Empty
        title="No memories yet"
        description="Your memories will appear here as they're created."
        icon="🧠"
      />
    );
  }

  return (
    <div ref={timelineRef} className="space-y-6 h-full py-2">
      {groupedMemories.map(({ date, memories: dayMemories }) => {
        const isCurrentDay = date === new Date().toISOString().split('T')[0];

        return (
          <div key={date} className="relative">
            <div className="flex font-semibold text-lg border-border py-3 mb-4 bg-[#74c5c4] dark:bg-accent pl-3 rounded-r-lg relative z-1">
              {formatDateForDisplay(date)}
            </div>

            <div className="absolute left-[14px] top-0 bottom-0 w-0.5 bg-[#0b5969]" />

            <div className="space-y-4 pl-8">
              {dayMemories.map((memory) => {
                const memoryDate = new Date(memory.timestamp);
                const now = new Date();
                const timeDiff = Math.abs(memoryDate.getTime() - now.getTime());
                const isCurrentTime =
                  isCurrentDay && !isNaN(memoryDate.getTime()) && timeDiff < 24 * 60 * 60 * 1000;

                return (
                  <div key={memory.id} data-current-time={isCurrentTime} className="relative">
                    <div className="absolute top-1/2 -left-4.25 transform -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-[#179298] border-2 border-[#179298]" />

                    <MemoryCard memory={memory} />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {loading && (
        <div className="flex justify-center py-8">
          <div className="flex items-center gap-3 text-muted-foreground">
            <div className="w-5 h-5 border-2 border-muted border-t-primary rounded-full animate-spin" />
            <span>Loading memories...</span>
          </div>
        </div>
      )}
    </div>
  );
}
