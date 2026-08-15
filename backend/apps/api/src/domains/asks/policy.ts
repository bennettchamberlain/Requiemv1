import type { AnswerForm, DisclosedAnswer, DisclosureRung, TrustTier } from './types';

import { canonicalDataClass } from './grantMatch';

/**
 * The disclosure ladder, coarsest first. Every rung discloses strictly less than
 * the one above it, so "downgrade" is always a safe direction to move.
 *
 *   none     — nothing at all (the ask is refused)
 *   boolean  — yes/no only
 *   count    — how many, no references
 *   summary  — a templated sentence + count
 *   redacted — item references the owner explicitly kept
 *   full     — every matching item reference
 */
export const DISCLOSURE_RUNGS: readonly DisclosureRung[] = [
  'none',
  'boolean',
  'count',
  'summary',
  'redacted',
  'full',
] as const;

const RUNG_INDEX: Readonly<Record<DisclosureRung, number>> = DISCLOSURE_RUNGS.reduce(
  (acc, rung, index) => ({ ...acc, [rung]: index }),
  {} as Record<DisclosureRung, number>,
);

/** Whether `a` discloses at least as much as `b`. */
export function rungAtLeast(a: DisclosureRung, b: DisclosureRung): boolean {
  return RUNG_INDEX[a] >= RUNG_INDEX[b];
}

/** The lesser (safer) of two rungs. */
export function minRung(a: DisclosureRung, b: DisclosureRung): DisclosureRung {
  return RUNG_INDEX[a] <= RUNG_INDEX[b] ? a : b;
}

/**
 * Data classes that are never disclosed automatically, whatever the tier says.
 * A grant may still authorize them, but only through explicit owner review —
 * the ceiling below forces `review` by capping the auto path at `none`.
 */
const SENSITIVE_CLASSES: ReadonlySet<string> = new Set([
  'health',
  'medical',
  'financial',
  'finance',
  'secrets',
  'credentials',
  'location',
]);

/**
 * Default disclosure ceiling per trust tier, mirroring the tier table in
 * ARCHITECTURE.md §8.1. `'*'` is the fallback for any class not named.
 *
 * This is a CEILING, not a grant: it can only ever reduce what a grant allows.
 * A tier never authorizes disclosure on its own — an ask still needs a matching
 * grant to be answered at all.
 */
const TIER_CEILINGS: Readonly<Record<TrustTier, Readonly<Record<string, DisclosureRung>>>> = {
  // Members of the owner's own household on the same box.
  household: { '*': 'full' },
  family: { '*': 'full', location: 'redacted' },
  trusted: { '*': 'redacted', location: 'summary' },
  peer: { '*': 'summary', photos: 'redacted', location: 'count' },
  stranger: { '*': 'boolean', location: 'none' },
};

/**
 * The most this asker may ever receive for this data class.
 *
 * Sensitive classes are capped at `none` for every tier below `family`, which
 * routes them to owner review rather than silently auto-answering. Unknown tiers
 * fall back to the strictest posture.
 */
export function disclosureCeiling(tier: TrustTier, dataClass?: string | null): DisclosureRung {
  const table = TIER_CEILINGS[tier] ?? TIER_CEILINGS.stranger;
  const canonical = canonicalDataClass(dataClass);

  if (canonical != null && SENSITIVE_CLASSES.has(canonical) && tier !== 'household' && tier !== 'family') {
    return 'none';
  }

  const forClass = canonical != null ? table[canonical] : undefined;

  return forClass ?? table['*'] ?? 'boolean';
}

/** The rung an answer of this form naturally occupies when nothing is withheld. */
export function rungForForm(form: AnswerForm): DisclosureRung {
  switch (form) {
    case 'boolean':
    case 'identity':
      return 'boolean';
    case 'existence':
      return 'count';
    case 'attribute':
      return 'summary';
    case 'retrieval':
    default:
      return 'full';
  }
}

/**
 * Clamp an already-built answer down to a ceiling.
 *
 * Downgrading only ever REMOVES information: item references are dropped first,
 * then counts, then everything. `withheldCount` is deliberately zeroed when the
 * ceiling hides the item set, because a withheld count is itself a signal about
 * how much the responder holds — at `count` and below the asker learns only what
 * the rung names.
 *
 * Pure.
 */
export function applyDisclosureCeiling(answer: DisclosedAnswer, ceiling: DisclosureRung): DisclosedAnswer {
  const natural = rungForForm(answer.form);
  const effective = minRung(natural, ceiling);

  if (effective === 'full' || effective === 'redacted') {
    // The item set already reflects the owner's redaction; nothing to clamp.
    return answer;
  }

  const base = { ...answer, items: [] };

  switch (effective) {
    case 'summary':
      return { ...base, withheldCount: 0 };
    case 'count':
      return { ...base, withheldCount: 0, summary: countOnlySummary(answer.disclosedCount) };
    case 'boolean':
      return {
        ...base,
        disclosedCount: answer.disclosedCount > 0 ? 1 : 0,
        withheldCount: 0,
        summary: answer.disclosedCount > 0 ? 'Yes.' : 'No.',
      };
    case 'none':
    default:
      return {
        ...base,
        disclosedCount: 0,
        withheldCount: 0,
        summary: 'Nothing was shared.',
      };
  }
}

function countOnlySummary(count: number): string {
  return count === 1 ? '1 matching item.' : `${count} matching items.`;
}
