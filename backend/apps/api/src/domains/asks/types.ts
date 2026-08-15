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
 * Relationship tier of an asker, coarsest trust last. `household` is a member of
 * the owner's own box; the rest mirror `PeerTrustTier` in the peers domain
 * (declared here rather than imported because peers depends on asks, not the
 * reverse).
 */
export type TrustTier = 'household' | 'family' | 'trusted' | 'peer' | 'stranger';

/**
 * How much an answer may disclose, coarsest first. See {@link DISCLOSURE_RUNGS}
 * in policy.ts — the ladder the owner's review UI exposes as "share less".
 */
export type DisclosureRung = 'none' | 'boolean' | 'count' | 'summary' | 'redacted' | 'full';

/**
 * The shape of an answer, which drives disclosure minimization (see
 * {@link inferAnswerForm}). Only `retrieval` returns item references; the rest
 * disclose a yes-no / count / synthesized value only.
 */
export type AnswerForm = 'boolean' | 'existence' | 'attribute' | 'retrieval' | 'identity';

/** Where an answer originated relative to the recipient's memory. */
export type AnswerSource = 'self' | 'peer';

/** A disclosed entity reference — id + type only, NEVER raw content. */
export interface DisclosedItem {
  id: string;
  type: string;
}

/** The disclosure-filtered answer produced for an ask. */
export interface DisclosedAnswer {
  form: AnswerForm;
  /** Item references (retrieval form only); empty for other forms. */
  items: DisclosedItem[];
  /** Count of matched items disclosed after the owner's redaction. */
  disclosedCount: number;
  /** Count of matched items the owner withheld (never itemized to the asker). */
  withheldCount: number;
  /** Templated, non-leaking natural-language summary. */
  summary: string;
  consentBasis: string | null;
}

export interface CreateAskAnswerDto {
  id?: string;
  askId: string;
  answer: DisclosedAnswer;
  answerSource?: AnswerSource;
}

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

/**
 * Structured scope attached to a grant — the grant vocabulary (ROADMAP Epic 2).
 *
 * Modelled on DWN's `ProtocolsConfigure` `$actions` pattern (borrowed as a
 * pattern, not a dependency): a grant names WHO may ask WHAT, and how much of an
 * answer they may receive. Every field only ever NARROWS the grant — an absent
 * field means "no restriction from this dimension", never "allow more".
 */
export interface AskGrantScope {
  /** If set, the grant only covers asks whose `dataClass` is in this list. */
  dataClasses?: string[];
  /** If set, the grant only covers these ask archetypes. */
  archetypes?: string[];
  /**
   * Caps how much any answer under this grant may disclose. Combined with the
   * tier ceiling by taking the LESSER of the two, so a grant can tighten the
   * tier default but never loosen it.
   */
  maxDisclosure?: DisclosureRung;
  /** Inclusive ISO bounds; asks outside the window do not match. */
  notBefore?: string;
  notAfter?: string;
  /** Purpose the grant is limited to, matched against the ask's stated purpose. */
  purpose?: string;
  [key: string]: unknown;
}

/** Result of {@link evaluateGrant}. */
export interface GrantEvaluation {
  decision: GrantDecision;
  /** The grant that decided the outcome, when one matched. */
  grantId?: string;
  /**
   * Ceiling the deciding grant imposes on any answer (its `scope.maxDisclosure`).
   * The caller combines this with the asker's tier ceiling by taking the LESSER
   * of the two, so neither can loosen the other.
   */
  maxDisclosure?: DisclosureRung;
}

/** Whether an ask is local to this box, sent to a peer, or received from one. */
export type AskDirection = 'local' | 'outbound' | 'inbound';

export interface CreateAskDto {
  id?: string;
  responderUserId: string;
  query: AskQuery;
  expiresAt?: Date | null;
  /**
   * Set for a federated ask. When `direction` is `inbound` the asker is the
   * peer (no local asker id); `outbound` records which peer we sent it to.
   */
  peerLinkId?: string | null;
  direction?: AskDirection;
}

export interface CreateAskGrantDto {
  id?: string;
  /** Exactly one of granteeUserId / granteePeerLinkId identifies the grantee. */
  granteeUserId?: string | null;
  /** Grant addressed to a linked peer Companion (federated asks). */
  granteePeerLinkId?: string | null;
  queryType: string;
  dataClass?: string | null;
  scope?: AskGrantScope | null;
  mode?: GrantMode;
  purpose?: string | null;
}

export interface RecordAskAuditDto {
  askId: string;
  /** NULL for an inbound peer ask — the asker is identified by `peerLinkId`. */
  askerUserId: string | null;
  peerLinkId?: string | null;
  peerHandle?: string | null;
  responderUserId: string;
  query: AskQuery;
  consentBasis?: string | null;
  outcome: AskAuditOutcome;
  disclosedEntities?: string[];
}
