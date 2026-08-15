/**
 * Pure presentation helpers for the ask surfaces.
 *
 * Kept free of React so they can be unit-tested directly — the disclosure and
 * consent vocabulary is exactly the sort of thing that must not drift silently
 * between the backend policy engine and what the owner is shown.
 */

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
 * Human summary of what a rung discloses, for the "share less" control.
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
