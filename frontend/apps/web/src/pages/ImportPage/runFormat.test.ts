import { describe, expect, it } from 'vitest';

import { compactNumber, computeFraction, formatDuration, runStatusLabel, stageLabel } from './runFormat';

describe('computeFraction', () => {
  it('returns null when there is no denominator', () => {
    // The load-bearing case. Null means indeterminate, and the bar animates
    // rather than inventing a width — a parse does not know how many records an
    // archive holds until it has read it.
    expect(computeFraction(412, null)).toBeNull();
    expect(computeFraction(412, undefined)).toBeNull();
    expect(computeFraction(412, 0)).toBeNull();
  });

  it('clamps to 0..1 rather than reporting past the end', () => {
    // A stage that overshoots its estimate must not render a bar wider than its
    // track.
    expect(computeFraction(120, 100)).toBe(1);
    expect(computeFraction(-5, 100)).toBe(0);
  });

  it('computes an honest ratio in between', () => {
    expect(computeFraction(25, 100)).toBe(0.25);
  });
});

describe('compactNumber', () => {
  it('shortens the counts a real import produces', () => {
    expect(compactNumber(412)).toBe('412');
    expect(compactNumber(12_400)).toBe('12.4k');
    expect(compactNumber(1_500_000)).toBe('1.5M');
  });
});

describe('formatDuration', () => {
  it('stays coarse, because a second-accurate estimate over 40GB is a fiction', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(252)).toBe('4m 12s');
    expect(formatDuration(7_800)).toBe('2h 10m');
  });

  it('has nothing to say about an unknown duration', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
  });
});

describe('runStatusLabel', () => {
  it('calls a partial import what it is: a success with gaps', () => {
    // Labelling this "Failed" is what sends someone back to re-upload a 40GB
    // archive over one parser that choked on one file.
    expect(runStatusLabel('partial')).toBe('Imported, with some items skipped');
    expect(runStatusLabel('completed')).toBe('Imported');
    expect(runStatusLabel('failed')).toBe('Failed');
  });

  it('passes through a status it does not know rather than blanking it', () => {
    expect(runStatusLabel('something_new')).toBe('something_new');
  });
});

describe('stageLabel', () => {
  it("names the three stages in the user's terms", () => {
    expect(stageLabel('unpack')).toBe('Unpack');
    expect(stageLabel('parse')).toBe('Read');
    expect(stageLabel('push')).toBe('Save');
  });
});
