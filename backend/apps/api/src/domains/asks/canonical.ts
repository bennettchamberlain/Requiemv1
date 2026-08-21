/**
 * Canonical form of the two asker-supplied strings the consent gate matches on:
 * a query's `dataClass` and its `queryType`.
 *
 * These must agree exactly with every consumer. The executor resolves its
 * entity-type hints through {@link canonicalDataClass}, so if grant matching
 * compared raw strings a peer could send `dataClass: 'Photos'` — evading a
 * `block` grant pinned to `photos` while still resolving to the photo entity
 * types downstream. Any normalization added here MUST be mirrored by every
 * consumer of `dataClass` / `queryType`.
 *
 * WHICH DIRECTION IS SAFE TO DRIFT IN. The mirror rule above is about the
 * dangerous direction: a consumer that normalizes MORE than this function does
 * would resolve (and therefore search) a string the gate never matched a block
 * against. Normalizing more HERE than a consumer does is the safe direction —
 * a block covers strings the executor cannot resolve at all, and a sensitive
 * class is recognised in more spellings than the search index answers to. That
 * asymmetry is why this is deliberately aggressive.
 *
 * Lives in its own module because both the consent evaluator (grantMatch) and
 * the policy engine (policy) need it, and importing it from either would create
 * a cycle between them.
 */

/**
 * Characters that render as NOTHING and therefore let two visually identical
 * strings compare unequal. `pho<U+200B>tos` renders as `photos` in the owner's
 * Grant Manager and in the asker's client, and compares unequal to it — which
 * is a block-evasion primitive, not a typo. Stripped rather than treated as
 * whitespace: they have no width, so collapsing them to a space would split one
 * word into two.
 *
 * Zero-width space / non-joiner / joiner, word joiner, soft hyphen, the
 * bidi/isolate formatting marks, and the BOM.
 */
const INVISIBLE = /[\u00ad\u200b-\u200f\u2060-\u2064\u206a-\u206f\ufeff]/gu;

/**
 * Every Unicode character that reads as a space, mapped onto the ASCII one.
 *
 * `\s` in JavaScript already covers most of these, but writing the class out
 * makes the intent explicit and pins the confusable pair that matters:
 * U+00A0 NO-BREAK SPACE is what a copy-paste out of a document produces, and
 * `photos<U+00A0>` evades a class-pinned block the same way a trailing ASCII
 * space would if this did not trim.
 */
const UNICODE_SPACE = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;

/**
 * The shared normalizer.
 *
 * ORDER MATTERS, and each step is here for a reason:
 *
 * 1. NFKC first — it folds the compatibility forms (fullwidth `ｐｈｏｔｏｓ`,
 *    ligatures) onto their plain equivalents. Run after case folding it would
 *    miss the forms whose folding changes case.
 * 2. Strip the invisibles, so a zero-width character cannot survive as a
 *    word-splitting space in step 3.
 * 3. Collapse every flavour of space to a single ASCII one, then trim.
 * 4. Lowercase last, so it applies to whatever NFKC produced.
 *
 * An empty result is `null`, never `''`: the callers read "no class named" off
 * a nullish value, and an empty string is not a class the owner wrote down.
 */
function canonicalToken(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const normalized = value
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(UNICODE_SPACE, ' ')
    .trim()
    .toLowerCase();

  return normalized ? normalized : null;
}

/** Canonical form of a data class, for BOTH grant matching and query execution. */
export function canonicalDataClass(value: string | null | undefined): string | null {
  return canonicalToken(value);
}

/**
 * Canonical form of a query type — the ask's ARCHETYPE, and the other half of
 * the grant-matching key.
 *
 * This did not exist, and `grantMatch` compared `grant.queryType` to
 * `query.queryType` RAW while routing `dataClass` through the canonicalizer
 * next door. The result was a block that a peer could walk straight past:
 * a block on `photos` denied `photos` and let `Photos`, `PHOTOS` and
 * `'photos '` through to owner review, from where a broad `auto` grant or an
 * inattentive tap answers them. The warning at the top of this file — mirror
 * the normalization everywhere — was written for `dataClass` and simply was
 * not honoured for the field beside it.
 */
export function canonicalQueryType(value: string | null | undefined): string | null {
  return canonicalToken(value);
}
