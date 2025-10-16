import { useEffect, useRef } from 'react';

import { MemoryCard } from './MemoryCard';
import { useMemoryTimeline } from './MemoryTimelineProvider';
import { sortMemoriesByTime, groupMemoriesByDate, formatDateForDisplay } from './utils';

export function MemoryTimeline() {
  const timelineRef = useRef<HTMLDivElement>(null);
  const {
    memories,
    loading,
    hasMorePast,
    hasMoreFuture,
    loadPastEvents,
    loadFutureEvents,
    loadingPast,
    loadingFuture,
  } = useMemoryTimeline();

  const sortedMemories = sortMemoriesByTime(memories);
  const groupedMemories = groupMemoriesByDate(sortedMemories);

  useEffect(() => {
    if (timelineRef.current && sortedMemories.length > 0) {
      setTimeout(() => {
        const container = timelineRef.current;
        if (!container) {
          return;
        }

        const currentTimeElement = container.querySelector('[data-current-time="true"]');
        if (currentTimeElement) {
          currentTimeElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
        } else {
          container.scrollTop = container.scrollHeight / 2;
        }
      }, 200);
    }
  }, [sortedMemories.length]);

  useEffect(() => {
    if (timelineRef.current && memories.length > 0) {
      const container = timelineRef.current;
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
    const container = timelineRef.current;
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
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
          <span className="text-2xl">🧠</span>
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-2">No memories yet</h3>
        <p className="text-gray-500">Your memories will appear here as they're created.</p>
      </div>
    );
  }

  return (
    <div
      ref={timelineRef}
      className="space-y-6 max-h-[calc(100vh-200px)] overflow-y-auto overflow-x-hidden"
      style={{ height: 'calc(100vh - 200px)' }}
    >
      {groupedMemories.map(({ date, memories: dayMemories }) => {
        const isCurrentDay = date === new Date().toISOString().split('T')[0];
        const dateObj = new Date(date);
        const now = new Date();
        const isPastDay = dateObj < now;

        return (
          <div key={date} className="relative">
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 py-3 mb-4">
              <div className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full ml-2 ${
                    isCurrentDay ? 'bg-blue-500' : isPastDay ? 'bg-gray-400' : 'bg-green-500'
                  }`}
                />
                <h2 className="text-lg font-semibold text-gray-900">{formatDateForDisplay(date)}</h2>
                {isCurrentDay && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">Today</span>
                )}
              </div>
            </div>

            <div className="absolute left-[14px] top-0 bottom-0 w-0.5 bg-gray-200" />

            <div className="space-y-4 pl-8">
              {dayMemories.map((memory) => {
                const memoryDate = new Date(memory.timestamp);
                const now = new Date();
                const timeDiff = Math.abs(memoryDate.getTime() - now.getTime());
                const isCurrentTime =
                  isCurrentDay && !isNaN(memoryDate.getTime()) && timeDiff < 24 * 60 * 60 * 1000;

                return (
                  <div key={memory.id} data-current-time={isCurrentTime} className="relative">
                    <div
                      className={`absolute -left-[23px] top-6 w-3 h-3 rounded-full border-2 border-white ${
                        isCurrentTime ? 'bg-blue-500' : isPastDay ? 'bg-gray-400' : 'bg-green-500'
                      }`}
                    />

                    <div className="transform transition-all duration-200 hover:scale-[1.005]">
                      <MemoryCard memory={memory} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {loading && (
        <div className="flex justify-center py-8">
          <div className="flex items-center gap-3 text-gray-500">
            <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin" />
            <span>Loading memories...</span>
          </div>
        </div>
      )}
    </div>
  );
}
