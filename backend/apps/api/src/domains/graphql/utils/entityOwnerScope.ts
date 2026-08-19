import { type RequestContext, type UserServiceContext, toServiceContext } from '@ci/common/context';

/**
 * Per-request memo of the owner-scoped contexts handed out by
 * {@link entityOwnerScope}, keyed by request and then by owner id.
 *
 * This is NOT an optimisation of the object allocation — it is what makes the
 * GraphQL DataLoaders work at all. {@link Loader.getLoader} caches one
 * DataLoader per service context in a `WeakMap` keyed by object IDENTITY, so a
 * fresh `{ userId }` literal per call meant every sub-field resolution built a
 * brand-new DataLoader and dispatched a batch of exactly one key. A page of N
 * media rows resolving 3 fields each cost 3N loaders and 6N queries instead of
 * the intended 2. Returning the same object for the same (request, owner) pair
 * restores the batching those loaders were written for.
 *
 * Keyed on the RequestContext so entries die with the request; the inner Map is
 * bounded by the number of distinct owners in one response (1 on every path but
 * shared search).
 */
const ownerScopeCache = new WeakMap<RequestContext, Map<string, UserServiceContext>>();

/**
 * Scope an entity node's lazily-resolved sub-fields (media, relations, tags) to
 * the entity's OWNER rather than the request's viewer.
 *
 * On a normal query the entity is already viewer-scoped, so its `userId` equals
 * the viewer's and this is a no-op. On the shared-search path (SearchResolver
 * .runSharedSearch) a result node belongs to the saved-search owner, not the
 * viewer — without this its thumbnails, location, people and tags would resolve
 * under the viewer's scope and come back empty (e.g. a shared photo gallery
 * would render blank). The node id is itself the authorization boundary: a
 * viewer only ever obtains nodes a resolver chose to hand them (the shared path
 * is the sole cross-user read), so resolving a node's sub-fields as that node's
 * owner widens nothing.
 *
 * Falls back to the viewer context when the node carries no `userId`.
 *
 * The returned object is stable per (request, owner) — see
 * {@link ownerScopeCache} for why that matters.
 */
export function entityOwnerScope(
  context: RequestContext,
  ownerId: string | null | undefined,
): UserServiceContext {
  if (!ownerId) {
    // toServiceContext already memoises per RequestContext, so this branch is
    // identity-stable on its own.
    return toServiceContext(context);
  }

  let byOwner = ownerScopeCache.get(context);

  if (!byOwner) {
    byOwner = new Map<string, UserServiceContext>();
    ownerScopeCache.set(context, byOwner);
  }

  let scope = byOwner.get(ownerId);

  if (!scope) {
    scope = { userId: ownerId };
    byOwner.set(ownerId, scope);
  }

  return scope;
}
