import { describe, expect, it } from 'vitest';

import {
  TIMELINE_MAX_SCALE_FACTOR,
  TIMELINE_MAX_ZOOM_INDEX,
  TIMELINE_ZOOM_SEQUENCE,
  timelineStoryOptions,
} from './timelineRuntime';

describe('timelineStoryOptions', () => {
  it('starts fully zoomed in on the TimeNav', () => {
    const options = timelineStoryOptions({
      startAtSlide: 0,
      bg: { r: 250, g: 250, b: 248 },
      languageUrl: '/locale/en.json',
    });

    expect(TIMELINE_ZOOM_SEQUENCE[TIMELINE_MAX_ZOOM_INDEX]).toBe(89);
    expect(options.scale_factor).toBe(TIMELINE_MAX_SCALE_FACTOR);
    expect(options.initial_zoom).toBe(TIMELINE_MAX_ZOOM_INDEX);
  });

  it('does not pull Knight Lab fonts, theme, or locale from their CDN', () => {
    const options = timelineStoryOptions({
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
