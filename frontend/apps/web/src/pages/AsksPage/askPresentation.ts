/**
 * Pure presentation helpers for the ask surfaces.
 *
 * Kept free of React so they can be unit-tested directly — the disclosure and
 * consent vocabulary is exactly the sort of thing that must not drift silently
 * between the backend policy engine and what the owner is shown.
 */

import type { AnswerForm } from '@/graphql/graphql';

/** Consent posture of a standing grant (mirrors GrantMode on the backend). */
export type GrantMode = 'auto' | 'review' | 'block';

/** How much an answer disclosed (mirrors DisclosureRung). Coarsest first. */
export type DisclosureRung = 'none' | 'boolean' | 'count' | 'summary' | 'redacted' | 'full';

export type AskStatus =
  | 'sent'
  | 'delivered'
  | 'under_review'
  | 'answering'
  | 'answered'
  | 'declined'
  | 'expired';

/**
 * Owner-facing label for a grant mode.
 *
 * Deliberately plain language: the Grant Manager is read by people deciding who
 * may ask them what, not by engineers.
 */
export function grantModeLabel(mode: GrantMode): string {
  switch (mode) {
    case 'auto':
      return 'Answers automatically';
    case 'block':
      return 'Blocked';
    case 'review':
    default:
      return 'Ask me first';
  }
}

/**
 * Short badge text for a grant mode.
 *
 * Every status is ALSO carried in text, never colour alone — WCAG 1.4.1 (use of
 * colour). The badge variant only reinforces what the words already say.
 */
export function grantModeBadge(mode: GrantMode): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
} {
  switch (mode) {
    case 'auto':
      return { label: 'Auto', variant: 'default' };
    case 'block':
      return { label: 'Blocked', variant: 'destructive' };
    case 'review':
    default:
      return { label: 'Ask first', variant: 'secondary' };
  }
}

/** Owner-facing status line for an ask. */
export function askStatusLabel(status: AskStatus): string {
  switch (status) {
    case 'sent':
      return 'Sending…';
    case 'delivered':
      return 'Waiting for them';
    case 'under_review':
      return 'Waiting for your review';
    case 'answering':
      return 'Preparing the answer';
    case 'answered':
      return 'Answered';
    case 'declined':
      return 'Declined';
    case 'expired':
      return 'Expired';
    default:
      return status;
  }
}

/** Whether an ask is still waiting on the owner. */
export function needsOwnerReview(status: AskStatus): boolean {
  return status === 'under_review';
}

/**
 * The provenance line shown on an answer — prose, not badges.
 *
 * "Answered by X's Companion, reviewed by X, under your family grant" is the
 * single most load-bearing sentence in the feature: it is how the asker knows
 * the answer is real, who stood behind it, and on what basis. An auto-answered
 * reply must never claim a human reviewed it.
 */
export function provenanceLine(params: {
  responderName: string;
  autoAnswered: boolean;
  consentBasis?: string | null;
}): string {
  const who = `Answered by ${params.responderName}'s Companion`;
  const how = params.autoAnswered
    ? 'answered automatically under a standing grant'
    : `reviewed by ${params.responderName}`;
  const basis = params.consentBasis ? ` · ${params.consentBasis}` : '';

  return `${who} · ${how}${basis}`;
}

/**
 * How the withheld count is described to the asker.
 *
 * The COUNT is disclosed; WHICH items were withheld never is. Returning null
 * (rather than "0 withheld") keeps the common case quiet.
 */
export function withheldNote(withheldCount: number): string | null {
  if (withheldCount <= 0) {
    return null;
  }

  return withheldCount === 1 ? '1 item withheld' : `${withheldCount} items withheld`;
}

/**
 * Human summary of what a rung discloses.
 *
 * NO CALLER TODAY, and deliberately kept. It was the "share less" control's
 * vocabulary until that control was rewired to `AnswerForm` — the type
 * `runAsk(disclosureForm:)` actually accepts — see OWNER_ANSWER_FORMS below for
 * why the two ladders are not interchangeable. Rungs remain the vocabulary of
 * CEILINGS on this page's roadmap ("this answer was capped at 'just how many'",
 * which the wire cannot yet say), so the words are worth keeping in one place
 * rather than reinvented later beside the form labels they must not duplicate.
 */
export function rungLabel(rung: DisclosureRung): string {
  switch (rung) {
    case 'full':
      return 'Everything that matched';
    case 'redacted':
      return 'Only what I pick';
    case 'summary':
      return 'A summary only';
    case 'count':
      return 'Just how many';
    case 'boolean':
      return 'Just yes or no';
    case 'none':
    default:
      return 'Nothing';
  }
}

/**
 * ═══ THE OWNER'S "ANSWER WITH LESS" LADDER ═══
 *
 * `rungLabel` above speaks `DisclosureRung`, which is the vocabulary of
 * CEILINGS — what a tier or a grant caps an answer at. It is NOT what
 * `runAsk(disclosureForm:)` accepts. That argument is an `AnswerForm`, and the
 * two ladders are related but not the same: `rungForForm` on the backend maps
 * boolean/identity → `boolean`, existence → `count`, attribute → `summary`,
 * retrieval → `full`. Offering the owner a rung and sending it as a form would
 * either fail the schema or, worse, send a value that means something else.
 *
 * So the control speaks forms, and the labels are written as CEILINGS ("at
 * most") rather than as promises ("a summary"). That wording is load-bearing:
 * `narrowerForm(chosen, inferred)` keeps whichever of the owner's pick and the
 * archetype-inferred form sits LOWER on the ladder, so the owner's choice can
 * only ever cap the answer. If the ask was already going to be a yes/no,
 * picking "at most a count" still yields a yes/no — which "at most" describes
 * correctly and "a count" would not.
 */
export const OWNER_ANSWER_FORMS: readonly AnswerForm[] = ['boolean', 'existence', 'attribute'];

/**
 * Owner-facing label for an answer form, phrased as the ceiling it imposes.
 *
 * `identity` is deliberately absent from {@link OWNER_ANSWER_FORMS}: it sits on
 * the same rung as `boolean` but reads differently to the asker ("yes, that is
 * me"), so it is a different ANSWER rather than a smaller one, and offering it
 * as a way to share less would be a lie about what it does.
 */
export function answerFormLabel(form: AnswerForm): string {
  switch (form) {
    case 'boolean':
      return 'At most yes or no';
    case 'existence':
      return 'At most how many';
    case 'attribute':
      return 'At most a summary';
    case 'identity':
      return 'At most confirming who they asked about';
    case 'retrieval':
    default:
      return 'At most the matching items';
  }
}

/**
 * Where an inbox ask actually stands, which is NOT the same question as who is
 * asking.
 *
 * The card used to render every pending ask identically and let a trust badge
 * ("known contact" / "no standing grant") carry the whole difference. That
 * badge answers "do I know them", and the owner reads it as "is this decision
 * still mine to make" — which it is not. An ask the owner PRE-AUTHORIZED with a
 * standing `auto` grant reaches the inbox already authorized: `AskService.submit`
 * leaves it at `delivered` and stamps `consentBasis`, and `isAnswerable` accepts
 * exactly that shape without any approval. Showing it with an Approve button and
 * a quarantine warning misdescribes it in both directions at once — it implies a
 * gate that has already opened, and it implies the owner is about to decide
 * something they decided earlier.
 *
 * The predicate below is deliberately the mirror image of the backend's
 * `isAnswerable(status, consentBasis)` second accepted shape. If that gate ever
 * changes, this must change with it or the card starts lying again.
 */
export type AskDecisionState =
  /** Already authorized by a standing grant; no approval is outstanding. */
  | 'pre-authorized'
  /** A grant matched, but it routes to the owner rather than answering. */
  | 'covered-review'
  /** Nothing covers this asker; the owner's decision is the only gate. */
  | 'unreviewed';

export function askDecisionState(
  status: AskStatus,
  consentBasis: string | null | undefined,
): AskDecisionState {
  if (!consentBasis) {
    return 'unreviewed';
  }

  return status === 'delivered' ? 'pre-authorized' : 'covered-review';
}

/** The sentence the consent card leads with, in the owner's own terms. */
export function askDecisionNote(state: AskDecisionState): string {
  switch (state) {
    case 'pre-authorized':
      return 'A standing grant you gave already authorizes this. It is waiting to be answered, not for your permission — decline it here if you have changed your mind.';
    case 'covered-review':
      return 'A standing grant covers this asker, and it routes their asks to you rather than answering them.';
    case 'unreviewed':
    default:
      return 'No standing grant covers this request. Nothing is shared unless you approve it.';
  }
}

/** Label for the card's primary button, which is a different act per state. */
export function askApproveLabel(state: AskDecisionState): string {
  return state === 'pre-authorized' ? 'Answer now' : 'Approve and answer';
}
