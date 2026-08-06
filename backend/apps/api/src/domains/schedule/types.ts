import type { RationaleSource, TimeFlex } from './entities/EventCandidateEntity';
import type { RhythmKind, RhythmSource, RhythmStrength } from './entities/RhythmEntity';

/**
 * `not_now`       — defer, propose again later
 * `wrong_time`    — the idea is right, the window is not
 * `not_like_this` — the idea is close but the framing is off
 * `never`         — retire permanently
 *
 * Callers reach this through GraphQL as a plain String; DECLINE_REASONS in
 * ScheduleCandidateResolver is the runtime list any such value is checked
 * against, and must be kept in step with this union.
 */
export type DeclineReason = 'not_now' | 'wrong_time' | 'not_like_this' | 'never';

/**
 * Generator prefix for anything the user typed themselves.
 *
 * Deliberately NOT under `adapter/`: SuggestionSyncService retires stale
 * `adapter/` rows whose source action was dismissed, and a hand-written task
 * has no upstream source to go stale.
 *
 * Lives here rather than beside the service that writes it because
 * CandidateService sorts on it and TaskBreakdownService stamps it — putting it
 * on either one would make the two import each other.
 */
export const USER_AUTHORED_GENERATOR_PREFIX = 'braindump/';

export interface CreateCandidateDto {
  title: string;
  description?: string;
  rationale: string;
  rationale_sources?: RationaleSource[];
  window_start: Date;
  window_end: Date;
  time_flex?: TimeFlex;
  duration_minutes?: number;
  constraints?: Record<string, unknown>;
  l0_class?: string;
  l1_cluster_id?: string;
  energy_cost?: number;
  /** Stable identity across runs; collisions with acted-on rows are suppressed. */
  dedupe_key: string;
  generator?: string;
  confidence?: number;
}

export interface CreateRhythmDto {
  label: string;
  kind: RhythmKind;
  spec: Record<string, unknown>;
  strength?: RhythmStrength;
  source?: RhythmSource;
  source_answer_id?: string;
}

export interface UpdateRhythmDto {
  label?: string;
  spec?: Record<string, unknown>;
  strength?: RhythmStrength;
  active?: boolean;
}
