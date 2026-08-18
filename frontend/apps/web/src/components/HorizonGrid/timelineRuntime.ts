import type { TimelineJsData } from './scheduleToTimeline';

export const TIMELINE_HEIGHT_PX = 360;

/** Knight Lab's TimeNav zoom ladder. Last entry is fully zoomed in. */
export const TIMELINE_ZOOM_SEQUENCE = [0.5, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89] as const;
export const TIMELINE_MAX_ZOOM_INDEX = TIMELINE_ZOOM_SEQUENCE.length - 1;
export const TIMELINE_MAX_SCALE_FACTOR = TIMELINE_ZOOM_SEQUENCE[TIMELINE_MAX_ZOOM_INDEX];

type Rgb = { r: number; g: number; b: number };

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

/**
 * Construct options: keep Today on our origin, fully zoomed, and cheap.
 *
 * `duration: 0` skips Knight Lab's 1s RAF easing. Local `language` avoids
 * cdn.knightlab.com. `font`/`theme` false skips Google Fonts CSS.
 */
export function timelineJsOptions({
  width,
  startAtSlide,
  bg,
  languageUrl,
}: {
  width?: number;
  startAtSlide: number;
  bg: Rgb;
  languageUrl: string;
}): Record<string, unknown> {
  return {
    height: TIMELINE_HEIGHT_PX,
    width,
    timenav_height: 96,
    timenav_height_percentage: 28,
    marker_height_min: 24,
    marker_padding: 3,
    start_at_slide: startAtSlide + 1,
    hash_bookmark: false,
    default_bg_color: bg,
    duration: 0,
    trackResize: false,
    soundcite: false,
    font: false,
    theme: false,
    language: languageUrl,
    optimal_tick_width: 180,
    scale_factor: TIMELINE_MAX_SCALE_FACTOR,
    initial_zoom: TIMELINE_MAX_ZOOM_INDEX,
    zoom_sequence: [...TIMELINE_ZOOM_SEQUENCE],
  };
}

/** @deprecated Use timelineJsOptions — kept so main's option tests keep compiling. */
export const timelineStoryOptions = timelineJsOptions;
