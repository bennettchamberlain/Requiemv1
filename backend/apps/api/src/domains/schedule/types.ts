import type { RationaleSource, TimeFlex } from './entities/EventCandidateEntity';
import type { RhythmKind, RhythmSource, RhythmStrength } from './entities/RhythmEntity';

/**
 * `not_now`       — defer, propose again later
 * `wrong_time`    — the idea is right, the window is not
 * `not_like_this` — the idea is close but the framing is off
 * `never`         — retire permanently
 */
export type DeclineReason = 'not_now' | 'wrong_time' | 'not_like_this' | 'never';

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
