import { describe, expect, it } from 'vitest';

import {
  clampToBounds,
  flingVelocity,
  glideStep,
  MAX_FLING_SPEED,
  MIN_FLING_SPEED,
  RESTITUTION,
  type Bounds,
  type PointerSample,
} from './throwPhysics';

const BOUNDS: Bounds = { minX: -100, maxX: 100, minY: -80, maxY: 80 };

/** A steady rightward drag: `speed` px/ms sampled every 10ms, ending at `now`. */
function steadyDrag(speed: number, now: number): PointerSample[] {
  return Array.from({ length: 6 }, (_, i) => ({
    x: (now - (5 - i) * 10) * speed,
    y: 0,
    t: now - (5 - i) * 10,
  }));
}

describe('flingVelocity', () => {
  it('recovers the speed of a steady drag', () => {
    const velocity = flingVelocity(steadyDrag(1, 1000), 1000);

    expect(velocity.x).toBeCloseTo(1, 5);
    expect(velocity.y).toBeCloseTo(0, 5);
  });

  it('treats a slow release as a placement, not a throw', () => {
    const velocity = flingVelocity(steadyDrag(MIN_FLING_SPEED / 2, 1000), 1000);

    expect(velocity).toEqual({ x: 0, y: 0 });
  });

  it('caps a wild gesture', () => {
    const velocity = flingVelocity(steadyDrag(MAX_FLING_SPEED * 4, 1000), 1000);

    expect(Math.hypot(velocity.x, velocity.y)).toBeCloseTo(MAX_FLING_SPEED, 5);
  });

  it('ignores history older than the sample window — the throw is the END of the gesture', () => {
    // A fast drag that stops: old fast samples, then the pointer holds still.
    const samples: PointerSample[] = [
      { x: 0, y: 0, t: 0 },
      { x: 300, y: 0, t: 100 },
      { x: 300, y: 0, t: 900 },
      { x: 300, y: 0, t: 1000 },
    ];

    expect(flingVelocity(samples, 1000)).toEqual({ x: 0, y: 0 });
  });

  it('returns rest for a bare tap', () => {
    expect(flingVelocity([{ x: 10, y: 10, t: 1000 }], 1000)).toEqual({ x: 0, y: 0 });
  });
});

describe('glideStep', () => {
  it('advances the position and decays the velocity', () => {
    const next = glideStep({ x: 0, y: 0 }, { x: 1, y: 0 }, 16, BOUNDS);

    expect(next.position.x).toBeCloseTo(16, 5);
    expect(next.velocity.x).toBeLessThan(1);
    expect(next.velocity.x).toBeGreaterThan(0);
    expect(next.moving).toBe(true);
  });

  it('bounces off a wall with reduced speed', () => {
    const next = glideStep({ x: 95, y: 0 }, { x: 2, y: 0 }, 16, BOUNDS);

    expect(next.position.x).toBe(BOUNDS.maxX);
    expect(next.velocity.x).toBeLessThan(0);
    expect(Math.abs(next.velocity.x)).toBeLessThanOrEqual(2 * RESTITUTION);
  });

  it('comes to rest instead of gliding forever', () => {
    let position = { x: 0, y: 0 };
    let velocity = { x: 2, y: 1.5 };
    let steps = 0;

    for (; steps < 1000; steps += 1) {
      const next = glideStep(position, velocity, 16, BOUNDS);
      position = next.position;
      velocity = next.velocity;

      if (!next.moving) {
        break;
      }
    }

    expect(steps).toBeLessThan(1000);
    expect(position.x).toBeLessThanOrEqual(BOUNDS.maxX);
    expect(position.y).toBeLessThanOrEqual(BOUNDS.maxY);
  });

  it('is framerate independent: one 32ms step decays like two 16ms steps', () => {
    const one = glideStep({ x: 0, y: 0 }, { x: 1, y: 0 }, 32, null);

    const halfway = glideStep({ x: 0, y: 0 }, { x: 1, y: 0 }, 16, null);
    const two = glideStep(halfway.position, halfway.velocity, 16, null);

    expect(one.velocity.x).toBeCloseTo(two.velocity.x, 5);
  });
});

describe('clampToBounds', () => {
  it('keeps a position inside the bounds', () => {
    expect(clampToBounds({ x: 500, y: -500 }, BOUNDS)).toEqual({ x: 100, y: -80 });
  });

  it('collapses to the minimum when the card is larger than its container', () => {
    const inverted: Bounds = { minX: 8, maxX: -40, minY: 8, maxY: -20 };

    expect(clampToBounds({ x: 100, y: 100 }, inverted)).toEqual({ x: 8, y: 8 });
  });
});
