import { useEffect, useRef, useState } from 'react';

import { cn } from '@ci/shadcn';
import timelineCssUrl from '@knight-lab/timelinejs/dist/css/timeline.css?url';
import timelineLocaleUrl from '@knight-lab/timelinejs/dist/js/locale/en.json?url';
import timelineJsUrl from '@knight-lab/timelinejs/dist/js/timeline.js?url';

import {
  TIMELINE_HEIGHT_PX,
  inertTimeline,
  syncTimeaxisLabelCollision,
  timelineDeckKey,
  timelineEventDiff,
  timelineJsOptions,
} from './timelineRuntime';
import type { TimelineJsData, TimelineSlide } from './types';
import './timelineTheme.css';

interface TimelineJsHostProps {
  data: TimelineJsData;
  startAtSlide: number;
  className?: string;
  /** Used when the host has no layout box yet (flex child before first paint). */
  fallbackHeightPx?: number;
  /**
   * When set, the instance remounts only if this identity changes. New slides
   * are added in place so an unfiltered buffer can grow without a flash.
   */
  sessionKey?: string;
  onSlideChange?: (uniqueId: string) => void;
}

type TimelineInstance = {
  ready?: boolean;
  current_id?: string;
  config?: { events?: Array<{ unique_id?: string }> } | null;
  animator_storyslider?: { stop?: () => void };
  animator_menubar?: { stop?: () => void };
  destroy?: () => void;
  on?: (event: string, callback: (payload?: { unique_id?: string }) => void) => void;
  add?: (data: unknown) => void;
  removeId?: (id: string) => void;
};

type TimelineCtor = new (
  elem: HTMLElement,
  data: unknown,
  options?: Record<string, unknown>,
) => TimelineInstance;

function mountedEventIds(instance: TimelineInstance): string[] {
  return (instance.config?.events ?? [])
    .map((event) => event.unique_id)
    .filter((id): id is string => Boolean(id));
}

function syncTimelineEvents(instance: TimelineInstance, events: readonly TimelineSlide[]): void {
  const { add, removeIds } = timelineEventDiff(mountedEventIds(instance), events);

  for (const event of add) {
    instance.add?.(event);
  }

  for (const id of [...removeIds].reverse()) {
    if (id !== instance.current_id) {
      instance.removeId?.(id);
    }
  }
}

type Rgb = { r: number; g: number; b: number };

let timelineLoad: Promise<TimelineCtor> | null = null;

function ensureTimelineCss(): Promise<void> {
  const existing = document.querySelector<HTMLLinkElement>('link[data-timelinejs-css]');
  if (existing) {
    return existing.sheet
      ? Promise.resolve()
      : new Promise((resolve) => {
          existing.addEventListener('load', () => resolve(), { once: true });
          existing.addEventListener('error', () => resolve(), { once: true });
        });
  }

  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = timelineCssUrl;
    link.dataset.timelinejsCss = '1';
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

/**
 * Load TimelineJS as a classic script (not an ESM import).
 *
 * The dist file is a UMD IIFE that assigns `window.TL`. Vite's ESM transform of
 * that file keeps `TL` module-local, so `globalThis.TL` stays undefined and the
 * story mounts empty.
 *
 * CSS is injected here too, instead of a static import, so the rest of Memory
 * does not wait on Knight Lab's 96kb stylesheet.
 */
function loadTimelineCtor(): Promise<TimelineCtor> {
  if (typeof window !== 'undefined' && window.TL?.Timeline) {
    const Timeline = window.TL.Timeline;

    return ensureTimelineCss().then(() => Timeline);
  }

  if (!timelineLoad) {
    timelineLoad = Promise.all([ensureTimelineCss(), loadTimelineScript()]).then(([, Timeline]) => Timeline);
  }

  return timelineLoad;
}

function loadTimelineScript(): Promise<TimelineCtor> {
  return new Promise<TimelineCtor>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-timelinejs]');
    if (existing && window.TL?.Timeline) {
      resolve(window.TL.Timeline);

      return;
    }

    const script = existing ?? document.createElement('script');
    script.dataset.timelinejs = '1';
    script.src = timelineJsUrl;
    script.async = true;
    script.onload = () => {
      if (window.TL?.Timeline) {
        resolve(window.TL.Timeline);
      } else {
        timelineLoad = null;
        reject(new Error('TimelineJS loaded without window.TL.Timeline'));
      }
    };

    script.onerror = () => {
      timelineLoad = null;
      reject(new Error('Failed to load TimelineJS script'));
    };

    if (!existing) {
      document.head.appendChild(script);
    }
  });
}

/** Resolve a CSS color (incl. theme tokens) to RGB for TimelineJS options. */
function cssColorToRgb(cssColor: string, fallback: Rgb): Rgb {
  const probe = document.createElement('div');
  probe.style.backgroundColor = cssColor;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).backgroundColor;
  document.body.removeChild(probe);

  const comma = resolved.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (comma) {
    return { r: Math.round(+comma[1]), g: Math.round(+comma[2]), b: Math.round(+comma[3]) };
  }

  const space = resolved.match(/rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (space) {
    return { r: Math.round(+space[1]), g: Math.round(+space[2]), b: Math.round(+space[3]) };
  }

  return fallback;
}

function timelineBgFromTheme(): Rgb {
  const isDark = document.documentElement.classList.contains('dark');

  return cssColorToRgb('var(--card)', isDark ? { r: 20, g: 28, b: 32 } : { r: 250, g: 250, b: 248 });
}

/**
 * TimelineJS3 host — mounts Knight Lab against a JSON deck.
 *
 * Remounts when {@link TimelineJsHostProps.sessionKey} (or the slide ids, when
 * no session is given) changes. Hidden chrome and CDN extras stay off; see
 * {@link timelineJsOptions}.
 */
export function TimelineJsHost({
  data,
  startAtSlide,
  className,
  fallbackHeightPx = TIMELINE_HEIGHT_PX,
  sessionKey,
  onSlideChange,
}: TimelineJsHostProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<TimelineInstance | null>(null);
  const onSlideChangeRef = useRef(onSlideChange);
  onSlideChangeRef.current = onSlideChange;
  const deckKey = timelineDeckKey(data, startAtSlide);
  const mountKey = sessionKey ?? deckKey;
  const payloadRef = useRef({ data, startAtSlide, fallbackHeightPx });
  payloadRef.current = { data, startAtSlide, fallbackHeightPx };
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [inView, setInView] = useState(true);
  const inViewRef = useRef(true);
  inViewRef.current = inView;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
      },
      { rootMargin: '80px', threshold: 0 },
    );
    observer.observe(host);

    return () => observer.disconnect();
  }, [mountKey]);

  useEffect(() => {
    const instance = instanceRef.current;
    if (!instance) {
      return;
    }

    instance.ready = inView && !document.hidden;
  }, [inView]);

  useEffect(() => {
    const host = hostRef.current;
    const { data: deck, startAtSlide: landing, fallbackHeightPx: minHeight } = payloadRef.current;
    if (!host || deck.events.length === 0) {
      return;
    }

    let cancelled = false;
    setError(null);
    setReady(false);
    inertTimeline(instanceRef.current);
    instanceRef.current = null;
    host.replaceChildren();
    const mount = document.createElement('div');
    mount.style.width = '100%';
    mount.style.height = '100%';
    host.appendChild(mount);

    const onVisibility = () => {
      const instance = instanceRef.current;
      if (!instance) {
        return;
      }

      instance.ready = inViewRef.current && !document.hidden;
    };

    document.addEventListener('visibilitychange', onVisibility);

    void loadTimelineCtor()
      .then((Timeline) => {
        if (cancelled || !host.contains(mount)) {
          return;
        }

        // Give the browser a paint so the host has a real layout box — TimelineJS
        // measures its container on construct and can paint 0×0 if we race it.
        requestAnimationFrame(() => {
          if (cancelled || !host.contains(mount)) {
            return;
          }

          try {
            const height = Math.max(mount.clientHeight || host.clientHeight || 0, minHeight);
            mount.style.height = `${height}px`;
            const instance = new Timeline(
              mount,
              deck,
              timelineJsOptions({
                width: mount.clientWidth || host.clientWidth || undefined,
                height,
                startAtSlide: landing,
                bg: timelineBgFromTheme(),
                languageUrl: timelineLocaleUrl,
              }),
            );
            instanceRef.current = instance;
            instance.ready = inViewRef.current && !document.hidden;
            const syncAxis = () => syncTimeaxisLabelCollision(mount);
            instance.on?.('zoom_in', syncAxis);
            instance.on?.('zoom_out', syncAxis);
            instance.on?.('change', (payload) => {
              const id = payload?.unique_id;
              if (id) {
                onSlideChangeRef.current?.(id);
              }
            });
            mount.addEventListener('click', (event) => {
              if (event.target instanceof Element && event.target.closest('.tl-menubar-button')) {
                requestAnimationFrame(syncAxis);
              }
            });
            requestAnimationFrame(syncAxis);
            setReady(true);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'TimelineJS failed to start');
          }
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'TimelineJS failed to load');
        }
      });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      inertTimeline(instanceRef.current);
      instanceRef.current = null;
      host.replaceChildren();
    };
  }, [mountKey]);

  useEffect(() => {
    if (!sessionKey || !ready) {
      return;
    }

    const instance = instanceRef.current;
    if (!instance) {
      return;
    }

    syncTimelineEvents(instance, data.events);
  }, [data.events, ready, sessionKey]);

  if (error) {
    return (
      <p role="alert" className="px-3 py-6 text-sm text-muted-foreground">
        Could not open the timeline ({error}).
      </p>
    );
  }

  return (
    <div className={cn('ci-timeline-js relative h-full w-full', className)}>
      {!ready && (
        <p className="absolute inset-0 z-10 flex items-center justify-center text-xs text-muted-foreground">
          Loading timeline…
        </p>
      )}
      <div ref={hostRef} className="h-full w-full [&_.tl-timeline]:h-full" />
    </div>
  );
}
