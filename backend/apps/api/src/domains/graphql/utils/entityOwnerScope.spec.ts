import { UnauthorizedException } from '@nestjs/common';

import { type RequestContext } from '@ci/common/context';

import { entityOwnerScope } from './entityOwnerScope';

/**
 * entityOwnerScope is, per its own docstring, "the sole cross-user read" in
 * the codebase: it lets a shared-search result node's sub-fields (media,
 * relations, tags) resolve as the node's OWNER rather than the request's
 * viewer, so a shared photo gallery isn't rendered blank under the viewer's
 * empty scope. That makes its two branches a real tenancy boundary —
 * widening scope when it shouldn't would leak another user's data through a
 * node id the resolver already handed the viewer.
 */
describe('entityOwnerScope', () => {
  it('scopes to the entity owner when ownerId is present, even for a different user than the viewer', () => {
    const viewerContext = { userId: 'viewer-1' } as unknown as RequestContext;

    const result = entityOwnerScope(viewerContext, 'owner-2');

    expect(result).toEqual({ userId: 'owner-2' });
  });

  it('falls back to the viewer context when ownerId is null', () => {
    const viewerContext = { userId: 'viewer-1' } as unknown as RequestContext;

    const result = entityOwnerScope(viewerContext, null);

    expect(result).toEqual({ userId: 'viewer-1' });
  });

  it('falls back to the viewer context when ownerId is undefined', () => {
    const viewerContext = { userId: 'viewer-1' } as unknown as RequestContext;

    const result = entityOwnerScope(viewerContext, undefined);

    expect(result).toEqual({ userId: 'viewer-1' });
  });

  it('treats an empty-string ownerId as absent and falls back to the viewer', () => {
    // entityOwnerScope branches on truthiness (`ownerId ? ... : ...`), so an
    // empty string — never a real entity id — takes the same safe fallback
    // path as null/undefined instead of being handed to the loader as a
    // (guaranteed-to-miss) scope. Pin the actual truthiness-based branch so a
    // refactor to an `ownerId != null` presence check doesn't silently change
    // this edge case.
    const viewerContext = { userId: 'viewer-1' } as unknown as RequestContext;

    const result = entityOwnerScope(viewerContext, '');

    expect(result).toEqual({ userId: 'viewer-1' });
  });

  it('propagates the viewer-context failure (no userId) rather than silently widening scope', () => {
    // When there is no ownerId AND no viewer userId, the safe behavior is to
    // reject the request (via toServiceContext's UnauthorizedException), not
    // to return some default scope that could read across users.
    const anonymousContext = {} as RequestContext;

    expect(() => entityOwnerScope(anonymousContext, null)).toThrow(UnauthorizedException);
  });

  it('does not widen scope when a null/undefined ownerId is combined with a real viewer', () => {
    // Regression guard for the inverse mistake: falling back to a fixed or
    // system scope instead of the actual viewer.
    const viewerContext = { userId: 'viewer-1' } as unknown as RequestContext;

    expect(entityOwnerScope(viewerContext, undefined)).not.toEqual({ userId: 'owner-2' });
  });
});
