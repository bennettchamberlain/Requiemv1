import { describe, expect, it, vi } from 'vitest';

import { inertTimeline, timelineDeckKey, timelineJsOptions } from './timelineRuntime';
import type { TimelineJsData } from './scheduleToTimeline';

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
    const options = timelineJsOptions(800, { r: 1, g: 2, b: 3 }, 0);

    expect(options.duration).toBe(0);
    expect(options.trackResize).toBe(false);
    expect(options.hash_bookmark).toBe(false);
    expect(options.soundcite).toBe(false);
    expect(options.optimal_tick_width).toBeGreaterThan(100);
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
