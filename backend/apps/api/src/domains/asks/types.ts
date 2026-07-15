/**
 * The interpersonal "ask" domain (CI-Server #1711 → epic #1712, Phase 0).
 *
 * An Ask is a question one person directs at another person's Companion memory.
 * It is the inverse of a shared saved search: instead of the owner publishing a
 * fixed query others run *as the owner*, the asker supplies a bounded query that
 * runs against the responder's memory and returns only what the responder allows.
 */

/** Lifecycle states of an Ask. See ARCHITECTURE.md §6 (ask lifecycle). */
export type AskStatus =
  | 'sent'
  | 'delivered'
  | 'under_review'
  | 'answering'
  | 'answered'
  | 'declined'
  | 'expired';

/** Terminal outcome recorded in the per-ask audit log. */
export type AskAuditOutcome = 'answered' | 'auto_answered' | 'declined' | 'expired';

/**
 * Three-state consent posture of a standing grant (the Grant Manager matrix):
 * `auto` answers without review, `review` routes to the owner's inbox (the
 * default), `block` denies outright.
 */
export type GrantMode = 'auto' | 'review' | 'block';

/** Outcome of evaluating an ask against the owner's standing grants. */
export type GrantDecision = 'auto' | 'review' | 'deny';

/**
 * The bounded, asker-supplied request. Phase 0 keeps this a light structured
 * shape; Phase 2 formalizes it as a DCQL subset (ROADMAP Epic 2). It is treated
 * as **hostile input** — validated and bounded before it ever executes in the
 * owner's scope (the security inversion vs today's owner-authored fixed query).
 */
export interface AskQuery {
  /** Coarse ask category; drives grant matching against `ask_grants.query_type`. */
  queryType: string;
  /** Optional finer data class, e.g. 'photos' | 'calendar' | 'location'. */
  dataClass?: string;
  /** The natural-language question as composed by the asker (shown back to both sides). */
  prompt: string;
  /** Optional structured filters mirroring the explorer capture (who / where / when). */
  filters?: Record<string, unknown>;
}

/** Optional structured scope attached to a grant. */
export interface AskGrantScope {
  /** If set, the grant only covers asks whose `dataClass` is in this list. */
  dataClasses?: string[];
  [key: string]: unknown;
}

/** Result of {@link evaluateGrant}. */
export interface GrantEvaluation {
  decision: GrantDecision;
  /** The grant that decided the outcome, when one matched. */
  grantId?: string;
}

export interface CreateAskDto {
  id?: string;
  responderUserId: string;
  query: AskQuery;
  expiresAt?: Date | null;
}

export interface CreateAskGrantDto {
  id?: string;
  granteeUserId: string;
  queryType: string;
  dataClass?: string | null;
  scope?: AskGrantScope | null;
  mode?: GrantMode;
  purpose?: string | null;
}

export interface RecordAskAuditDto {
  askId: string;
  askerUserId: string;
  responderUserId: string;
  query: AskQuery;
  consentBasis?: string | null;
  outcome: AskAuditOutcome;
  disclosedEntities?: string[];
}
