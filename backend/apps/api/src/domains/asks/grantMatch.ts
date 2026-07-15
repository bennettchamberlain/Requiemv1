import type { AskGrant } from './entities/AskGrantEntity';
import type { AskQuery, GrantEvaluation } from './types';

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
  const matches = grants.filter(
    (grant) => isActive(grant, now) && grantMatchesQuery(grant, query),
  );

  const block = matches.find((grant) => grant.mode === 'block');
  if (block) {
    return { decision: 'deny', grantId: block.id };
  }

  const auto = matches.find((grant) => grant.mode === 'auto');
  if (auto) {
    return { decision: 'auto', grantId: auto.id };
  }

  const review = matches.find((grant) => grant.mode === 'review');
  if (review) {
    return { decision: 'review', grantId: review.id };
  }

  return { decision: 'review' };
}

function isActive(grant: AskGrant, now: Date): boolean {
  return grant.revokedAt == null || grant.revokedAt > now;
}

function grantMatchesQuery(grant: AskGrant, query: AskQuery): boolean {
  if (grant.queryType !== query.queryType) {
    return false;
  }

  // A grant that pins a specific data_class only covers asks in that class.
  if (grant.dataClass != null && grant.dataClass !== query.dataClass) {
    return false;
  }

  // A grant whose scope enumerates data classes requires membership.
  const scopedClasses = grant.scope?.dataClasses;
  if (scopedClasses != null && scopedClasses.length > 0) {
    if (query.dataClass == null || !scopedClasses.includes(query.dataClass)) {
      return false;
    }
  }

  return true;
}
