import { describe, expect, it, vi } from 'vitest';

import type { TimelineJsData } from './scheduleToTimeline';
import {
  TIMELINE_MAX_SCALE_FACTOR,
  TIMELINE_MAX_ZOOM_INDEX,
  TIMELINE_ZOOM_SEQUENCE,
  inertTimeline,
  timelineDeckKey,
  timelineJsOptions,
} from './timelineRuntime';

function deck(ids: string[]): TimelineJsData {
  return {
    scale: 'human',
    title: {
      unique_id: 'focus-title',
      start_date: { year: '2026', month: '8', day: '18', hour: '0', minute: '0' },
      text: { headline: 'Today', text: '' },
    },
    events: ids.map((id) => ({
      unique_id: id,
      start_date: { year: '2026', month: '8', day: '18', hour: '9', minute: '0' },
      text: { headline: id, text: '' },
    })),
  };
}

describe('timelineDeckKey', () => {
  it('stays stable when only the array identity changed', () => {
    expect(timelineDeckKey(deck(['a', 'b']), 1)).toBe(timelineDeckKey(deck(['a', 'b']), 1));
  });

  it('changes when the slide set or landing index changes', () => {
    expect(timelineDeckKey(deck(['a', 'b']), 0)).not.toBe(timelineDeckKey(deck(['a', 'b']), 1));
    expect(timelineDeckKey(deck(['a']), 0)).not.toBe(timelineDeckKey(deck(['a', 'b']), 0));
  });
});

describe('timelineJsOptions', () => {
  it('turns off the 1s Knight Lab easing and analytics-adjacent extras', () => {
    const options = timelineJsOptions({
      width: 800,
      startAtSlide: 0,
      bg: { r: 1, g: 2, b: 3 },
      languageUrl: '/locale/en.json',
    });

    expect(options.duration).toBe(0);
    expect(options.trackResize).toBe(false);
    expect(options.hash_bookmark).toBe(false);
    expect(options.soundcite).toBe(false);
    expect(options.optimal_tick_width).toBeGreaterThan(100);
  });

  it('starts fully zoomed in on the TimeNav', () => {
    const options = timelineJsOptions({
      startAtSlide: 0,
      bg: { r: 250, g: 250, b: 248 },
      languageUrl: '/locale/en.json',
    });

    expect(TIMELINE_ZOOM_SEQUENCE[TIMELINE_MAX_ZOOM_INDEX]).toBe(89);
    expect(options.scale_factor).toBe(TIMELINE_MAX_SCALE_FACTOR);
    expect(options.initial_zoom).toBe(TIMELINE_MAX_ZOOM_INDEX);
  });

  it('does not pull Knight Lab fonts, theme, or locale from their CDN', () => {
    const options = timelineJsOptions({
      startAtSlide: 2,
      bg: { r: 20, g: 28, b: 32 },
      languageUrl: '/assets/en-local.json',
    });

    expect(options.font).toBe(false);
    expect(options.theme).toBe(false);
    expect(options.soundcite).toBe(false);
    expect(options.language).toBe('/assets/en-local.json');
    expect(options.start_at_slide).toBe(3);
  });
});

describe('inertTimeline', () => {
  it('stops leftover animators and makes resize/keydown handlers no-ops', () => {
    const stopSlider = vi.fn();
    const stopMenu = vi.fn();
    const instance = {
      ready: true,
      config: { events: [] },
      animator_storyslider: { stop: stopSlider },
      animator_menubar: { stop: stopMenu },
    };

    inertTimeline(instance);

    expect(instance.ready).toBe(false);
    expect(instance.config).toBeNull();
    expect(stopSlider).toHaveBeenCalledTimes(1);
    expect(stopMenu).toHaveBeenCalledTimes(1);
  });
});
