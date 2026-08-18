import type { TimelineJsData } from './scheduleToTimeline';

export const TIMELINE_HEIGHT_PX = 360;

type TimelineAnimators = {
  ready?: boolean;
  config?: unknown | null;
  animator_storyslider?: { stop?: () => void };
  animator_menubar?: { stop?: () => void };
};

/**
 * TimelineJS has no public destroy(). It always binds window resize and
 * document keydown. Marking the instance inert stops those handlers from
 * doing layout work after we tear the DOM down.
 */
export function inertTimeline(instance: TimelineAnimators | null | undefined): void {
  if (!instance) {
    return;
  }

  instance.ready = false;
  instance.config = null;
  instance.animator_storyslider?.stop?.();
  instance.animator_menubar?.stop?.();
}

/** Rebuild only when the slide set actually changed, not on Apollo array identity. */
export function timelineDeckKey(data: TimelineJsData, startAtSlide: number): string {
  return `${startAtSlide}:${data.events.map((event) => event.unique_id).join(',')}`;
}

export function timelineJsOptions(width: number, bg: { r: number; g: number; b: number }, startAtSlide: number) {
  return {
    height: TIMELINE_HEIGHT_PX,
    width: width || undefined,
    timenav_height: 96,
    timenav_height_percentage: 28,
    marker_height_min: 24,
    marker_padding: 3,
    start_at_slide: startAtSlide + 1,
    hash_bookmark: false,
    // Knight Lab defaults this to 1000ms of RAF easing on every nav/layout.
    duration: 0,
    trackResize: false,
    soundcite: false,
    // Fewer axis ticks — the time-nav canvas is the hot path (Knight Lab #458).
    optimal_tick_width: 180,
    default_bg_color: bg,
    font: 'Default',
  };
}
