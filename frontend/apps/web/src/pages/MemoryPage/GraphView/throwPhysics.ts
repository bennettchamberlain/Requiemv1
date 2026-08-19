/**
 * Throw physics for the floating graph dialogs.
 *
 * A released card keeps the velocity the pointer gave it and glides out under friction,
 * bouncing softly off the shell's edges — the "thrown" feel, rather than stopping dead the
 * instant the pointer lifts. Kept as pure functions so the `node` vitest project can pin the
 * behaviour down without a DOM.
 */

export type Vec = { x: number; y: number };

/** Allowed translate range that keeps the card inside its container. */
export type Bounds = { minX: number; maxX: number; minY: number; maxY: number };

export type PointerSample = { x: number; y: number; t: number };

/** Velocity retained per 16ms frame; ~0.94 reads as a glide, not a puck on ice. */
export const FRICTION_PER_FRAME = 0.94;
const FRAME_MS = 16;

/** Below this speed (px/ms) the card is at rest and the animation stops. */
export const STOP_SPEED = 0.02;

/** How much speed survives a wall hit. Soft: the card settles after a bounce or two. */
export const RESTITUTION = 0.35;

/** Only pointer history this recent describes the throw; older motion is a different gesture. */
export const FLING_SAMPLE_WINDOW_MS = 120;

/** Slower releases than this (px/ms) are a placement, not a throw. */
export const MIN_FLING_SPEED = 0.15;

/** Velocity cap (px/ms) so a wild gesture cannot rocket the card around the shell. */
export const MAX_FLING_SPEED = 3;

export function clampToBounds(position: Vec, bounds: Bounds): Vec {
  return {
    x: Math.min(Math.max(position.x, bounds.minX), Math.max(bounds.minX, bounds.maxX)),
    y: Math.min(Math.max(position.y, bounds.minY), Math.max(bounds.minY, bounds.maxY)),
  };
}

/**
 * The velocity of a release, from the pointer's recent history.
 *
 * Measured across the whole recent window rather than the last two events: pointer deltas
 * quantise badly at high report rates, and a two-sample estimate flips wildly between frames.
 * Returns a zero vector for a placement (too slow, or no usable history), which callers read
 * as "do not glide".
 */
export function flingVelocity(samples: readonly PointerSample[], now: number): Vec {
  const recent = samples.filter((sample) => now - sample.t <= FLING_SAMPLE_WINDOW_MS);

  if (recent.length < 2) {
    return { x: 0, y: 0 };
  }

  const first = recent[0];
  const last = recent[recent.length - 1];
  const dt = last.t - first.t;

  if (dt <= 0) {
    return { x: 0, y: 0 };
  }

  let vx = (last.x - first.x) / dt;
  let vy = (last.y - first.y) / dt;

  const speed = Math.hypot(vx, vy);
  if (speed < MIN_FLING_SPEED) {
    return { x: 0, y: 0 };
  }

  if (speed > MAX_FLING_SPEED) {
    const scale = MAX_FLING_SPEED / speed;
    vx *= scale;
    vy *= scale;
  }

  return { x: vx, y: vy };
}

export type GlideState = {
  position: Vec;
  velocity: Vec;
  /** False once the card has come to rest; the caller stops its animation frame loop. */
  moving: boolean;
};

/**
 * One integration step of the glide: advance, bounce off any wall hit, decay.
 *
 * Friction is applied as a per-frame retention raised to dt/16 so a dropped frame does not
 * make the card travel further — the decay is framerate-independent.
 */
export function glideStep(position: Vec, velocity: Vec, dtMs: number, bounds: Bounds | null): GlideState {
  let x = position.x + velocity.x * dtMs;
  let y = position.y + velocity.y * dtMs;
  let vx = velocity.x;
  let vy = velocity.y;

  if (bounds) {
    const maxX = Math.max(bounds.minX, bounds.maxX);
    const maxY = Math.max(bounds.minY, bounds.maxY);

    if (x < bounds.minX) {
      x = bounds.minX;
      vx = -vx * RESTITUTION;
    } else if (x > maxX) {
      x = maxX;
      vx = -vx * RESTITUTION;
    }

    if (y < bounds.minY) {
      y = bounds.minY;
      vy = -vy * RESTITUTION;
    } else if (y > maxY) {
      y = maxY;
      vy = -vy * RESTITUTION;
    }
  }

  const decay = Math.pow(FRICTION_PER_FRAME, dtMs / FRAME_MS);
  vx *= decay;
  vy *= decay;

  return {
    position: { x, y },
    velocity: { x: vx, y: vy },
    moving: Math.hypot(vx, vy) > STOP_SPEED,
  };
}
