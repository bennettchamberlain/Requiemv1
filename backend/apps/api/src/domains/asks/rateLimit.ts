/**
 * Pure sliding-window rate-limit check for the ask path. Keeping the arithmetic
 * pure makes the abuse control unit-testable without timers or a container.
 */
export interface RateLimitDecision {
  allowed: boolean;
  /** Milliseconds until the next attempt would be allowed (0 when allowed). */
  retryAfterMs: number;
  /** Remaining allowance in the current window after this attempt. */
  remaining: number;
}

/**
 * Given the timestamps (ms) of prior attempts in ascending order, decide whether
 * a new attempt at `now` is allowed under a `max`-per-`windowMs` sliding window.
 * Returns the timestamps to retain (expired ones dropped; the new one appended
 * only when allowed) alongside the decision.
 */
export function checkSlidingWindow(
  timestamps: readonly number[],
  now: number,
  windowMs: number,
  max: number,
): { kept: number[]; decision: RateLimitDecision } {
  const cutoff = now - windowMs;
  const kept = timestamps.filter((t) => t > cutoff);

  if (kept.length >= max) {
    const oldest = kept[0];
    const retryAfterMs = Math.max(0, oldest + windowMs - now);

    return { kept, decision: { allowed: false, retryAfterMs, remaining: 0 } };
  }

  kept.push(now);

  return { kept, decision: { allowed: true, retryAfterMs: 0, remaining: max - kept.length } };
}
