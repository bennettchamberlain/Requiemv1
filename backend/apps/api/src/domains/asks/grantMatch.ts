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
 * @param grants MUST already be scoped to (owner = responder, grantee = asker);
 *   this function does not re-check ownership.
 */
export function evaluateGrant(
  query: AskQuery,
  grants: readonly AskGrant[],
  now: Date = new Date(),
): GrantEvaluation {
  const active = grants.filter((grant) => isActive(grant, now));

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

  const auto = matches.find((grant) => grant.mode === 'auto');
  if (auto) {
    return { decision: 'auto', grantId: auto.id, maxDisclosure: ceilingOf(auto) };
  }

  const review = matches.find((grant) => grant.mode === 'review');
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

function isActive(grant: AskGrant, now: Date): boolean {
  return grant.revokedAt == null || grant.revokedAt > now;
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
