import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useDeviceLayout } from '@ci/common';
import { cn } from '@ci/shadcn';
import { Loader2 } from '@ci/shadcn/icons';

const PULL_THRESHOLD_PX = 56;
const PULL_MAX_PX = 88;

function scrollerFrom(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) {
    return null;
  }

  const hit = target.closest('[data-page-scroll], [data-list-scroll]');

  return hit instanceof HTMLElement ? hit : null;
}

/**
 * Phone-only: pull down at the top of a Memory list to refetch that view.
 *
 * Listens on the nearest `data-page-scroll` / `data-list-scroll` ancestor of
 * the touch so hub pages and the explorer list share one gesture.
 */
export function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<unknown> | unknown;
  children: ReactNode;
}) {
  const { isMobile } = useDeviceLayout();
  const rootRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const pullRef = useRef(0);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const root = rootRef.current;

    if (!isMobile || !root) {
      return;
    }

    const onStart = (event: TouchEvent) => {
      if (refreshing || event.touches.length !== 1) {
        startY.current = null;

        return;
      }

      const scroller = scrollerFrom(event.target);

      if (!scroller || scroller.scrollTop > 0) {
        startY.current = null;

        return;
      }

      startY.current = event.touches[0].clientY;
    };

    const onMove = (event: TouchEvent) => {
      if (startY.current == null || refreshing) {
        return;
      }

      const scroller = scrollerFrom(event.target);

      if (!scroller) {
        return;
      }

      const dy = event.touches[0].clientY - startY.current;

      if (dy > 0 && scroller.scrollTop <= 0) {
        const next = Math.min(dy * 0.45, PULL_MAX_PX);
        pullRef.current = next;
        setPull(next);

        if (event.cancelable) {
          event.preventDefault();
        }
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    };

    const finish = () => {
      const released = pullRef.current;
      startY.current = null;
      pullRef.current = 0;
      setPull(0);

      if (released < PULL_THRESHOLD_PX || refreshing) {
        return;
      }

      setRefreshing(true);
      void Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
    };

    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchmove', onMove, { passive: false });
    root.addEventListener('touchend', finish);
    root.addEventListener('touchcancel', finish);

    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchmove', onMove);
      root.removeEventListener('touchend', finish);
      root.removeEventListener('touchcancel', finish);
    };
  }, [isMobile, onRefresh, refreshing]);

  if (!isMobile) {
    return children;
  }

  const show = refreshing || pull > 8;

  return (
    <div ref={rootRef} className="relative h-full min-h-0 flex-1">
      <div
        aria-hidden={!show}
        aria-busy={refreshing || undefined}
        data-testid="pull-to-refresh"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-1 transition-opacity',
          show ? 'opacity-100' : 'opacity-0',
        )}
        style={{ transform: `translateY(${refreshing ? 6 : Math.max(0, pull - 20)}px)` }}
      >
        <Loader2
          className={cn(
            'h-5 w-5 text-muted-foreground',
            (refreshing || pull >= PULL_THRESHOLD_PX) && 'animate-spin',
          )}
        />
      </div>
      {children}
    </div>
  );
}
