import { canonicalDataClass } from './canonical';
import type { AskGrant } from './entities/AskGrantEntity';
import { DISCLOSURE_RUNGS } from './policy';
import type { AskQuery, DisclosureRung, GrantEvaluation } from './types';

export { canonicalDataClass };

/**
 * Pure, per-query consent evaluation — the heart of the ask gate.
 *
 * Given the owner's standing grants for one grantee and the grantee's ask,
 * decide whether the ask is auto-answered, routed to owner review, or denied.
 * The evaluation is **deny-biased and review-by-default**:
 *
 * - a matching `block` grant always wins → `deny`;
 * - else a matching `auto` grant → `auto`;
 * - else a matching `review` grant → `review`;
 * - else (no matching grant) → `review` — owner review is the floor, there is
 *   never implicit open access.
 *
 * `block` taking precedence over `auto` means a narrow block can always override
 * a broad standing pre-authorization (the safe default).
 *
 * A `null` `data_class` is read in OPPOSITE directions on the two paths — a
 * wildcard for `block`, not a wildcard for `auto` — because both readings must
 * resolve toward denial. See {@link autoGrantNamesQueryClass}.
 *
 * @param grants MUST already be scoped to (owner = responder, grantee = asker);
 *   this function does not re-check ownership.
 */
export function evaluateGrant(
  query: AskQuery,
  grants: readonly AskGrant[],
  now: Date = new Date(),
): GrantEvaluation {
  const active = grants.filter((grant) => isGrantActive(grant, now));

  // Blocks are evaluated CONSERVATIVELY (see blockCoversQuery): an ask that
  // omits its data class cannot be proven to fall outside a class-scoped block,
  // so it is treated as covered. This closes the bypass where an asker evades a
  // narrow block by simply not naming the class it targets, then rides a broad
  // `auto` grant. A matching block always wins → deny.
  const block = active.find((grant) => grant.mode === 'block' && blockCoversQuery(grant, query));
  if (block) {
    return { decision: 'deny', grantId: block.id };
  }

  // Positive grants (auto / review) match strictly on the declared class.
  const matches = active.filter((grant) => grant.mode !== 'block' && grantMatchesQuery(grant, query));

  // An `auto` grant must additionally NAME the class it pre-authorizes
  // (see autoGrantNamesQueryClass) — a class-less auto grant is not a wildcard.
  const auto = matches.find((grant) => grant.mode === 'auto' && autoGrantNamesQueryClass(grant, query));
  if (auto) {
    return { decision: 'auto', grantId: auto.id, maxDisclosure: ceilingOf(auto) };
  }

  // An explicit `review` grant is preferred as the basis; failing that, an
  // `auto` grant that matched but was too broad to auto-answer is DOWNGRADED to
  // review rather than dropped. The owner said something about this asker and
  // this query type, so the ask belongs in their inbox with that grant named —
  // the only thing withheld is the automatic answer.
  const review =
    matches.find((grant) => grant.mode === 'review') ?? matches.find((grant) => grant.mode === 'auto');
  if (review) {
    return { decision: 'review', grantId: review.id, maxDisclosure: ceilingOf(review) };
  }

  return { decision: 'review' };
}

/** The grant's own disclosure ceiling, if it declares one. */
function ceilingOf(grant: AskGrant): DisclosureRung | undefined {
  const max = grant.scope?.maxDisclosure;

  return typeof max === 'string' && (DISCLOSURE_RUNGS as readonly string[]).includes(max)
    ? (max as DisclosureRung)
    : undefined;
}

/**
 * Whether a grant is in force right now.
 *
 * Two INDEPENDENT lifecycle facts, deliberately not merged into one column:
 *
 * - `revokedAt` records an EVENT — "the owner withdrew this at time T". It is
 *   never a schedule. Any non-null value means revoked, full stop, including a
 *   value in the future (clock skew, a replicated row, a hand-written fixture).
 *   This used to read `revokedAt == null || revokedAt > now`, i.e. a future
 *   `revokedAt` counted as still-active — a "scheduled expiry" branch that could
 *   never fire, because `GrantService` only ever stamps `now()`, and that
 *   actively misled anyone who tried to use it: writing a future date there
 *   revoked the grant on the spot as far as every SQL read path was concerned
 *   (`WHERE revoked_at IS NULL`) while this predicate said the opposite. Two
 *   readers of the same column disagreeing about whether consent stands is not
 *   a feature worth keeping.
 * - `expiresAt` is that schedule, as its own column. "I revoked this" and "this
 *   lapsed on its own" are different events and the audit must tell them apart.
 *
 * Exported because the SQL read paths (`GrantService`) can filter `revoked_at`
 * but must apply the same expiry rule in-process, and a second, subtly
 * different copy of this predicate is exactly how a revoked grant keeps
 * answering.
 */
export function isGrantActive(grant: AskGrant, now: Date = new Date()): boolean {
  if (grant.revokedAt != null) {
    return false;
  }

  return grant.expiresAt == null || grant.expiresAt > now;
}

/**
 * Whether a positive (auto/review) grant covers a query. Strict on class: a
 * grant pinned to (or scoped to a set of) data classes only covers asks whose
 * declared class is that class / in that set.
 */
function grantMatchesQuery(grant: AskGrant, query: AskQuery): boolean {
  return classMatchesQuery(grant, query) && scopeCoversQuery(grant, query);
}

/**
 * SECURITY ASYMMETRY — an `auto` grant must NAME the data class it
 * pre-authorizes. Read this before "simplifying" the two null cases into one.
 *
 * `data_class` is nullable, and a null means different things on the two paths
 * on purpose. Both nulls resolve toward DENIAL, which is why they point in
 * opposite directions:
 *
 * - BLOCK (deny broadly = safe): a null is a WILDCARD. A block on the query type
 *   covers every class, and {@link blockCoversQuery} additionally treats an ask
 *   that omits its class as covered — an asker must not escape a block by
 *   declining to name what they are after.
 * - AUTO (allow broadly = UNSAFE): a null is NOT a wildcard. A grant that names
 *   no class pre-authorizes only asks that name no class either. It never
 *   silently extends to a class the owner never considered.
 *
 * The bug this closes: an `auto` grant on query type `photos` with a null
 * `data_class` auto-answered an ask declaring `dataClass: 'medical-records'` —
 * the owner pre-authorized holiday snaps and the asker collected medical
 * records, with no owner review, because null read as "any class". PR #2042
 * hardened the block path against class omission; the auto path kept the
 * wildcard.
 *
 * Note the deliberate consequence: a class-less `auto` grant still auto-answers
 * class-less asks (an availability or relationship archetype has no meaningful
 * data class), so the grant vocabulary stays usable. What it can no longer do is
 * cover a class the owner did not write down.
 *
 * A grant that pins `data_class`, or enumerates `scope.dataClasses`, has already
 * been narrowed to that class by {@link classMatchesQuery} and needs nothing
 * further here.
 */
function autoGrantNamesQueryClass(grant: AskGrant, query: AskQuery): boolean {
  const namesAClass = canonicalDataClass(grant.dataClass) != null || grant.scope?.dataClasses != null;

  return namesAClass || canonicalDataClass(query.dataClass) == null;
}

/**
 * The queryType + data-class half of matching, shared by positive and block
 * grants.
 *
 * Deliberately excludes the narrowing dimensions in {@link scopeCoversQuery}:
 * a block must stay broad (see {@link blockCoversQuery}).
 */
function classMatchesQuery(grant: AskGrant, query: AskQuery): boolean {
  if (grant.queryType !== query.queryType) {
    return false;
  }

  const queryClass = canonicalDataClass(query.dataClass);
  const grantClass = canonicalDataClass(grant.dataClass);

  // A grant that pins a specific data_class only covers asks in that class.
  if (grantClass != null && grantClass !== queryClass) {
    return false;
  }

  // A grant whose scope enumerates data classes requires membership. An empty
  // list means "no classes permitted" — it matches nothing (an unscoped grant
  // omits the `dataClasses` key entirely, leaving `scopedClasses` undefined).
  const scopedClasses = grant.scope?.dataClasses;
  if (scopedClasses != null) {
    const allowed = scopedClasses.map(canonicalDataClass).filter((c): c is string => c != null);
    if (queryClass == null || !allowed.includes(queryClass)) {
      return false;
    }
  }

  return true;
}

/**
 * The remaining grant-vocabulary dimensions (archetype, validity window,
 * purpose). Each only ever NARROWS: an absent field imposes no restriction, and
 * a present one that fails to match drops the grant out of consideration.
 *
 * These are checked for POSITIVE grants only — a `block` must never be narrowed
 * by its own scope, or an asker could evade it by falling just outside the
 * window (see {@link blockCoversQuery}).
 */
function scopeCoversQuery(grant: AskGrant, query: AskQuery): boolean {
  const scope = grant.scope;
  if (scope == null) {
    return true;
  }

  // Archetype restriction: the ask's queryType IS its archetype.
  if (scope.archetypes != null) {
    const allowed = scope.archetypes.map((a) => canonicalDataClass(a)).filter((a): a is string => a != null);
    if (!allowed.includes(query.queryType.trim().toLowerCase())) {
      return false;
    }
  }

  // Validity window, evaluated against the ask's own window when it declares
  // one. An ask with no window can't be proven inside a bounded grant, so a
  // windowed grant does not cover it.
  const askFrom = typeof query.filters?.from === 'string' ? query.filters.from : undefined;
  const askTo = typeof query.filters?.to === 'string' ? query.filters.to : undefined;

  if (scope.notBefore != null) {
    if (askFrom == null || askFrom < scope.notBefore) {
      return false;
    }
  }

  if (scope.notAfter != null) {
    if (askTo == null || askTo > scope.notAfter) {
      return false;
    }
  }

  // Purpose binding: a purpose-limited grant requires the ask to state that
  // same purpose.
  if (scope.purpose != null) {
    const asked = typeof query.filters?.purpose === 'string' ? query.filters.purpose : undefined;
    if (canonicalDataClass(asked) !== canonicalDataClass(scope.purpose)) {
      return false;
    }
  }

  return true;
}

/**
 * Whether a `block` grant covers a query. Same as {@link grantMatchesQuery} for
 * a concrete class, but deny-biased for under-specified asks: a block on the
 * queryType covers an ask that omits its data class, so a scoped block cannot be
 * evaded by omission.
 */
function blockCoversQuery(grant: AskGrant, query: AskQuery): boolean {
  if (grant.queryType !== query.queryType) {
    return false;
  }

  if (canonicalDataClass(query.dataClass) == null) {
    return true;
  }

  // Note: `classMatchesQuery`, NOT `grantMatchesQuery` — a block is never
  // narrowed by its own window/purpose/archetype scope. Applying those here
  // would let an asker slip past a block by falling just outside its validity
  // window or by omitting the purpose it names.
  return classMatchesQuery(grant, query);
}
