import type { AskGrant } from './entities/AskGrantEntity';
import { evaluateGrant } from './grantMatch';
import type { AskGrantScope, AskQuery, GrantMode } from './types';

const NOW = new Date('2026-07-15T00:00:00Z');

function grant(overrides: Partial<AskGrant> = {}): AskGrant {
  return {
    id: overrides.id ?? 'grant-1',
    ownerUserId: 'owner',
    granteeUserId: 'asker',
    queryType: 'photos',
    dataClass: null,
    scope: null as AskGrantScope | null,
    mode: 'auto' as GrantMode,
    purpose: null,
    createdAt: NOW,
    revokedAt: null,
    ...overrides,
  } as AskGrant;
}

function ask(overrides: Partial<AskQuery> = {}): AskQuery {
  return { queryType: 'photos', prompt: 'do you have photos of us?', ...overrides };
}

describe('evaluateGrant', () => {
  it('defaults to owner review when no grant matches', () => {
    expect(evaluateGrant(ask(), [], NOW)).toEqual({ decision: 'review' });
    expect(evaluateGrant(ask(), [grant({ queryType: 'calendar' })], NOW)).toEqual({
      decision: 'review',
    });
  });

  it('auto-answers on a matching active auto grant', () => {
    expect(evaluateGrant(ask(), [grant({ mode: 'auto' })], NOW)).toEqual({
      decision: 'auto',
      grantId: 'grant-1',
    });
  });

  it('routes to review on a matching review grant', () => {
    expect(evaluateGrant(ask(), [grant({ mode: 'review' })], NOW)).toEqual({
      decision: 'review',
      grantId: 'grant-1',
    });
  });

  it('denies on a matching block grant', () => {
    expect(evaluateGrant(ask(), [grant({ mode: 'block' })], NOW)).toEqual({
      decision: 'deny',
      grantId: 'grant-1',
    });
  });

  it('block wins over auto (deny-biased precedence)', () => {
    const grants = [grant({ id: 'a', mode: 'auto' }), grant({ id: 'b', mode: 'block' })];
    expect(evaluateGrant(ask(), grants, NOW)).toEqual({ decision: 'deny', grantId: 'b' });
  });

  it('a class-scoped block cannot be bypassed by an ask that omits its data class', () => {
    // Owner blocks a specific class but broadly auto-answers the query type.
    const grants = [
      grant({ id: 'block-medical', mode: 'block', queryType: 'health', dataClass: 'medical' }),
      grant({ id: 'auto-health', mode: 'auto', queryType: 'health', dataClass: null }),
    ];
    // An ask that names the blocked class is denied...
    expect(evaluateGrant(ask({ queryType: 'health', dataClass: 'medical' }), grants, NOW)).toEqual({
      decision: 'deny',
      grantId: 'block-medical',
    });
    // ...and an ask that OMITS the class must not slip through to auto.
    expect(evaluateGrant(ask({ queryType: 'health' }), grants, NOW)).toEqual({
      decision: 'deny',
      grantId: 'block-medical',
    });
    // A concrete ask in a different class is unaffected by the medical block.
    expect(evaluateGrant(ask({ queryType: 'health', dataClass: 'fitness' }), grants, NOW)).toEqual({
      decision: 'auto',
      grantId: 'auto-health',
    });
  });

  it('SECURITY: canonicalizes dataClass so a scoped block cannot be evaded by casing', () => {
    // The executor resolves entity-type hints with dataClass.toLowerCase(), so
    // if matching compared raw strings, 'Photos' would evade a block pinned to
    // 'photos' while still resolving to photo entities downstream.
    const grants = [
      grant({ id: 'block-photos', mode: 'block', queryType: 'content', dataClass: 'photos' }),
      grant({ id: 'auto-content', mode: 'auto', queryType: 'content', dataClass: null }),
    ];

    for (const variant of ['photos', 'Photos', 'PHOTOS', '  photos  ']) {
      expect(evaluateGrant(ask({ queryType: 'content', dataClass: variant }), grants, NOW)).toEqual({
        decision: 'deny',
        grantId: 'block-photos',
      });
    }
  });

  it('treats an empty scope.dataClasses as "no classes permitted" (matches nothing)', () => {
    const emptyScoped = grant({ mode: 'auto', scope: { dataClasses: [] } });
    expect(evaluateGrant(ask({ dataClass: 'beach' }), [emptyScoped], NOW)).toEqual({
      decision: 'review',
    });
    expect(evaluateGrant(ask(), [emptyScoped], NOW)).toEqual({ decision: 'review' });
  });

  it('ignores a revoked grant', () => {
    const revoked = grant({ mode: 'auto', revokedAt: new Date('2026-07-14T00:00:00Z') });
    expect(evaluateGrant(ask(), [revoked], NOW)).toEqual({ decision: 'review' });
  });

  it('treats a future revocation as still active', () => {
    const future = grant({ mode: 'auto', revokedAt: new Date('2026-07-16T00:00:00Z') });
    expect(evaluateGrant(ask(), [future], NOW)).toEqual({ decision: 'auto', grantId: 'grant-1' });
  });

  it('respects a grant pinned to a specific data class', () => {
    const pinned = grant({ mode: 'auto', dataClass: 'beach' });
    expect(evaluateGrant(ask({ dataClass: 'beach' }), [pinned], NOW)).toEqual({
      decision: 'auto',
      grantId: 'grant-1',
    });
    // Ask outside the pinned class does not match → review by default.
    expect(evaluateGrant(ask({ dataClass: 'work' }), [pinned], NOW)).toEqual({ decision: 'review' });
    expect(evaluateGrant(ask(), [pinned], NOW)).toEqual({ decision: 'review' });
  });

  it('enforces scope.dataClasses membership', () => {
    const scoped = grant({ mode: 'auto', scope: { dataClasses: ['beach', 'lake'] } });
    expect(evaluateGrant(ask({ dataClass: 'lake' }), [scoped], NOW)).toEqual({
      decision: 'auto',
      grantId: 'grant-1',
    });
    expect(evaluateGrant(ask({ dataClass: 'work' }), [scoped], NOW)).toEqual({ decision: 'review' });
    expect(evaluateGrant(ask(), [scoped], NOW)).toEqual({ decision: 'review' });
  });
});

describe('grant vocabulary (Phase 2)', () => {
  it('archetype scope narrows a grant to the named archetypes', () => {
    const g = grant({ mode: 'auto', scope: { archetypes: ['content'] } });
    expect(evaluateGrant(ask({ queryType: 'photos' }), [g], NOW).decision).toBe('review');

    const matching = grant({ mode: 'auto', queryType: 'content', scope: { archetypes: ['content'] } });
    expect(evaluateGrant(ask({ queryType: 'content' }), [matching], NOW).decision).toBe('auto');
  });

  it('a validity window requires the ask to declare a window inside it', () => {
    const g = grant({
      mode: 'auto',
      scope: { notBefore: '2026-07-01T00:00:00Z', notAfter: '2026-07-31T00:00:00Z' },
    });

    // ask with no window cannot be proven inside the grant
    expect(evaluateGrant(ask(), [g], NOW).decision).toBe('review');

    // inside
    expect(
      evaluateGrant(ask({ filters: { from: '2026-07-10T00:00:00Z', to: '2026-07-12T00:00:00Z' } }), [g], NOW)
        .decision,
    ).toBe('auto');

    // straddling the end
    expect(
      evaluateGrant(ask({ filters: { from: '2026-07-10T00:00:00Z', to: '2026-08-10T00:00:00Z' } }), [g], NOW)
        .decision,
    ).toBe('review');
  });

  it('a purpose-bound grant requires the ask to state that purpose', () => {
    const g = grant({ mode: 'auto', scope: { purpose: 'Wedding Invites' } });

    expect(evaluateGrant(ask(), [g], NOW).decision).toBe('review');
    expect(evaluateGrant(ask({ filters: { purpose: 'wedding invites' } }), [g], NOW).decision).toBe('auto');
    expect(evaluateGrant(ask({ filters: { purpose: 'something else' } }), [g], NOW).decision).toBe('review');
  });

  it('surfaces the grant maxDisclosure ceiling to the caller', () => {
    const g = grant({ mode: 'auto', scope: { maxDisclosure: 'count' } });
    expect(evaluateGrant(ask(), [g], NOW).maxDisclosure).toBe('count');

    // a bogus rung is ignored rather than trusted
    const bogus = grant({ mode: 'auto', scope: { maxDisclosure: 'everything' as never } });
    expect(evaluateGrant(ask(), [bogus], NOW).maxDisclosure).toBeUndefined();
  });

  describe('a block is never narrowed by its own scope', () => {
    it('still blocks an ask outside the block grant validity window', () => {
      const blocked = grant({
        id: 'blk',
        mode: 'block',
        scope: { notBefore: '2026-07-01T00:00:00Z', notAfter: '2026-07-31T00:00:00Z' },
      });
      const broadAuto = grant({ id: 'auto', mode: 'auto' });

      // an ask well outside the block's window must STILL be denied
      const outside = ask({ filters: { from: '2027-01-01T00:00:00Z', to: '2027-01-02T00:00:00Z' } });
      expect(evaluateGrant(outside, [broadAuto, blocked], NOW)).toEqual({
        decision: 'deny',
        grantId: 'blk',
      });
    });

    it('still blocks an ask that omits the purpose the block names', () => {
      const blocked = grant({ id: 'blk', mode: 'block', scope: { purpose: 'research' } });
      const broadAuto = grant({ id: 'auto', mode: 'auto' });

      expect(evaluateGrant(ask(), [broadAuto, blocked], NOW)).toEqual({
        decision: 'deny',
        grantId: 'blk',
      });
    });
  });
});
