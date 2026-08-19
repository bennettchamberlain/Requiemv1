import { useEffect, useRef } from 'react';

import { useLocation } from 'react-router-dom';

import { usePowerRail } from '../PowerRailContext';
import { RailEdgeToggle } from '../RailEdgeToggle';
import { SecondaryNavigation } from '../SecondaryNavigation';

const EDGE_PX = 28;
const THRESHOLD_PX = 48;

/**
 * Phone chrome around the glass Power Rail.
 *
 * Closed: a `|→` control at the top-left, below the status bar, and a swipe
 * right from the left edge. Open: the same rail as desktop, glassed, with `←|`
 * on its trailing edge. Everything lives in that rail — no bottom tab bar.
 */
export function MobileNavigation() {
  const { expanded, toggle, openOverlay, closeOverlay } = usePowerRail();
  const { pathname } = useLocation();
  const start = useRef<{ x: number; y: number; tracking: boolean } | null>(null);

  useEffect(() => {
    closeOverlay();
  }, [pathname, closeOverlay]);

  useEffect(() => {
    const onStart = (event: TouchEvent) => {
      const touch = event.touches[0];

      if (!touch) {
        return;
      }

      const fromEdge = touch.clientX <= EDGE_PX;
      const fromRail = expanded && touch.clientX <= 224;

      start.current = {
        x: touch.clientX,
        y: touch.clientY,
        tracking: expanded ? fromRail : fromEdge,
      };
    };

    const onEnd = (event: TouchEvent) => {
      const origin = start.current;
      start.current = null;

      if (!origin?.tracking) {
        return;
      }

      const touch = event.changedTouches[0];

      if (!touch) {
        return;
      }

      const dx = touch.clientX - origin.x;
      const dy = touch.clientY - origin.y;

      if (Math.abs(dy) > Math.abs(dx)) {
        return;
      }

      if (!expanded && dx >= THRESHOLD_PX) {
        openOverlay();
      } else if (expanded && dx <= -THRESHOLD_PX) {
        closeOverlay();
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [expanded, openOverlay, closeOverlay]);

  return (
    <>
      {!expanded && (
        <div className="ci-mobile-chrome-top fixed left-[max(0.5rem,env(safe-area-inset-left,0px))] z-50">
          <RailEdgeToggle open={false} onClick={toggle} />
        </div>
      )}

      {expanded && (
        <button
          type="button"
          aria-label="Dismiss menu"
          className="fixed inset-0 z-30 bg-black/25"
          onClick={closeOverlay}
        />
      )}

      <SecondaryNavigation />
    </>
  );
}
