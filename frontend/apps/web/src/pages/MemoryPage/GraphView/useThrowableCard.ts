import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import {
  clampToBounds,
  flingVelocity,
  glideStep,
  type Bounds,
  type PointerSample,
  type Vec,
} from './throwPhysics';

const EDGE_MARGIN_PX = 8;

/**
 * Makes a floating card draggable by a handle, with throw momentum on release.
 *
 * The card keeps its CSS anchor (e.g. `absolute right-3 top-3`) and moves via a translate
 * offset written straight to `element.style.transform` — the drag and the glide never go
 * through React state, so a 120Hz pointer or a long fling costs no re-renders. Bounds are
 * measured from the card's offset parent each step, so the card cannot be thrown out of the
 * graph shell even while it is resizing.
 *
 * Only the returned `handleProps` start a drag (spread them on the card's header): making the
 * whole card a handle would fight text selection and the card body's own scrolling.
 */
export function useThrowableCard() {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef<Vec>({ x: 0, y: 0 });
  const velocityRef = useRef<Vec>({ x: 0, y: 0 });
  const samplesRef = useRef<PointerSample[]>([]);
  const draggingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const dragStartRef = useRef({ pointerX: 0, pointerY: 0, offsetX: 0, offsetY: 0 });

  const applyTransform = () => {
    const element = cardRef.current;
    if (element) {
      element.style.transform = `translate(${offsetRef.current.x}px, ${offsetRef.current.y}px)`;
    }
  };

  /**
   * The translate range that keeps the card inside its offset parent. `offsetLeft/Top` are
   * layout positions unaffected by the transform, so this stays correct mid-flight.
   */
  const measureBounds = (): Bounds | null => {
    const element = cardRef.current;
    const parent = element?.offsetParent as HTMLElement | null;

    if (!element || !parent) {
      return null;
    }

    return {
      minX: EDGE_MARGIN_PX - element.offsetLeft,
      maxX: parent.clientWidth - EDGE_MARGIN_PX - element.offsetWidth - element.offsetLeft,
      minY: EDGE_MARGIN_PX - element.offsetTop,
      maxY: parent.clientHeight - EDGE_MARGIN_PX - element.offsetHeight - element.offsetTop,
    };
  };

  const stopGlide = () => {
    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  };

  const startGlide = () => {
    stopGlide();

    let last = performance.now();

    const step = (now: number) => {
      // Cap dt so a background-tab pause does not integrate into one huge teleport.
      const dt = Math.min(now - last, 48);
      last = now;

      const next = glideStep(offsetRef.current, velocityRef.current, dt, measureBounds());
      offsetRef.current = next.position;
      velocityRef.current = next.velocity;
      applyTransform();

      frameRef.current = next.moving ? requestAnimationFrame(step) : null;
    };

    frameRef.current = requestAnimationFrame(step);
  };

  useEffect(() => stopGlide, []);

  const handleProps = useMemo(
    () => ({
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
          return;
        }

        // Buttons and links on the header still work as themselves.
        const target = event.target as HTMLElement | null;
        if (target?.closest('button, a, input, textarea, select')) {
          return;
        }

        stopGlide();
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStartRef.current = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          offsetX: offsetRef.current.x,
          offsetY: offsetRef.current.y,
        };
        samplesRef.current = [{ x: event.clientX, y: event.clientY, t: performance.now() }];
      },
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) {
          return;
        }

        const start = dragStartRef.current;
        const raw = {
          x: start.offsetX + (event.clientX - start.pointerX),
          y: start.offsetY + (event.clientY - start.pointerY),
        };
        const bounds = measureBounds();

        offsetRef.current = bounds ? clampToBounds(raw, bounds) : raw;
        applyTransform();

        samplesRef.current.push({ x: event.clientX, y: event.clientY, t: performance.now() });
        if (samplesRef.current.length > 8) {
          samplesRef.current.shift();
        }
      },
      onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current) {
          return;
        }

        draggingRef.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);

        velocityRef.current = flingVelocity(samplesRef.current, performance.now());
        if (velocityRef.current.x !== 0 || velocityRef.current.y !== 0) {
          startGlide();
        }
      },
      onPointerCancel: () => {
        draggingRef.current = false;
      },
      // touch-none: the handle owns its touches; without it mobile drags scroll the page.
      className: 'cursor-grab active:cursor-grabbing select-none touch-none',
    }),
    [],
  );

  return { cardRef, handleProps };
}
