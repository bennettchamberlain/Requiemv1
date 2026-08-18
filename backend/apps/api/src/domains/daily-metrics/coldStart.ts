import { MIN_PAIR_N } from './correlation/correlationMath';

/** Coverage-gated day floor shared by engines, grounded prompts, and agent copy. */
export const COLD_START_MIN_DAYS = MIN_PAIR_N;
export const COLD_START_MIN_COVERAGE = 0.5;
/** Shared Brief producer cap for `source IN ('anomaly','suggestion')` per user local day. */
export const MAX_DERIVED_ACTIONS_PER_DAY = 3;

export function stillLearning(topic: string): string {
  return `Still learning your patterns for ${topic}.`;
}

export function isCoverageGated(
  coverage: number | null | undefined,
  value: number | null | undefined,
): boolean {
  return (coverage ?? 0) >= COLD_START_MIN_COVERAGE && value !== null && value !== undefined;
}
