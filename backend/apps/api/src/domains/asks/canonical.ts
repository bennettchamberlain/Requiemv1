/**
 * Canonical form of a data class, used for BOTH grant matching and query
 * execution.
 *
 * These two must agree exactly. The executor resolves its entity-type hints
 * with `dataClass.toLowerCase()`, so if grant matching compared raw strings a
 * peer could send `dataClass: 'Photos'` — evading a `block` grant pinned to
 * `photos` while still resolving to the photo entity types downstream. Any
 * normalization added here MUST be mirrored by every consumer of `dataClass`.
 *
 * Lives in its own module because both the consent evaluator (grantMatch) and
 * the policy engine (policy) need it, and importing it from either would create
 * a cycle between them.
 */
export function canonicalDataClass(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();

  return trimmed ? trimmed : null;
}
