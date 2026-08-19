/**
 * Object identity — canonical URLs, natural keys, and the identity ladder.
 *
 * Foundation layer of `docs/prd/unified-content-identity-lifecycle-embeds.md`.
 * Nothing consumes it yet; wiring it into the ingest write paths is design P2.
 *
 * The module has no dependencies beyond Node builtins so it can be lifted into
 * `backend/packages/object-identity` if it needs to stand alone. Design P3
 * originally planned to vendor it verbatim into CI-Import-Tools, with
 * `fixtures/identity-fixtures.json` executed by both repos' test runners as
 * the cross-repo contract — moot now that CI-Import-Tools is retired and its
 * import functionality is native here.
 */
export { canonicalizeUrl } from './canonicalizeUrl';
export { buildNaturalKey, sha256Hex } from './naturalKey';
export type { NaturalKeyFallback, NaturalKeyInput } from './naturalKey';
export { primaryIdentity, resolveIdentities } from './resolveIdentities';
export {
  applyHostAlias,
  matchProvider,
  matchProviderUri,
  HOST_ALIASES,
  PROVIDER_RULES,
  SHORTENERS,
} from './providers';
export type { ProviderMatch } from './providers';
export {
  DROP_IF_EMPTY,
  GLOBAL_TRACKING_PARAMS,
  HOST_SCOPED_TRACKING,
  hostScopedTrackingParams,
  isTrackingParam,
} from './tracking';
export { IDENTITY_KIND_PRECEDENCE, IDENTITY_SPEC_VERSION, MAX_VALUE_NORMALIZED_LENGTH } from './types';
export type { CanonicalUrl, Dimension, Identity, IdentityInput, IdentityKind, SourceTriple } from './types';
