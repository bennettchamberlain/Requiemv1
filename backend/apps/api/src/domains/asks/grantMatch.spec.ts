import type { AskGrant } from './entities/AskGrantEntity';
import { evaluateGrant, isGrantActive } from './grantMatch';
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
    updatedAt: NOW,
    revokedAt: null,
    expiresAt: null,
    revocationReason: null,
    version: 1,
    supersedesGrantId: null,
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
    // A concrete ask in a different class is unaffected by the medical block —
    // but it does NOT auto-answer either: `auto-health` names no data class, and
    // a class-less auto grant is not a wildcard (see the DEFECT 1 block below).
    // It is downgraded to owner review with that grant as the basis.
    expect(evaluateGrant(ask({ queryType: 'health', dataClass: 'fitness' }), grants, NOW)).toEqual({
      decision: 'review',
      grantId: 'auto-health',
    });
  });

  // DEFECT 1 — the auto/block asymmetry on a null data_class.
  describe('SECURITY: a class-less `auto` grant is not a wildcard', () => {
    it('does not auto-answer an ask that declares a class the grant never named', () => {
      // The audit's exact reproduction: an `auto` grant on the `photos` query
      // type with data_class NULL, and an ask declaring `medical-records`.
      const plainPhotos = grant({ id: 'auto-photos', mode: 'auto', queryType: 'photos', dataClass: null });

      expect(evaluateGrant(ask({ dataClass: 'medical-records' }), [plainPhotos], NOW)).toEqual({
        decision: 'review',
        grantId: 'auto-photos',
      });
    });

    it('still auto-answers a class-less ask (the archetypes that have no data class)', () => {
      const plain = grant({ id: 'auto-availability', mode: 'auto', queryType: 'availability' });

      expect(evaluateGrant(ask({ queryType: 'availability' }), [plain], NOW)).toEqual({
        decision: 'auto',
        grantId: 'auto-availability',
      });
    });

    it('a class-less BLOCK stays a wildcard — the asymmetry is the point', () => {
      // Both nulls resolve toward denial: broad for block, narrow for auto.
      const blockAll = grant({ id: 'block-all', mode: 'block', dataClass: null });

      expect(evaluateGrant(ask({ dataClass: 'medical-records' }), [blockAll], NOW)).toEqual({
        decision: 'deny',
        grantId: 'block-all',
      });
    });

    it('an explicitly class-named auto grant is unaffected', () => {
      const named = grant({ id: 'auto-medical', mode: 'auto', dataClass: 'medical-records' });
      const enumerated = grant({ id: 'auto-set', mode: 'auto', scope: { dataClasses: ['medical-records'] } });

      expect(evaluateGrant(ask({ dataClass: 'medical-records' }), [named], NOW)).toEqual({
        decision: 'auto',
        grantId: 'auto-medical',
      });
      expect(evaluateGrant(ask({ dataClass: 'medical-records' }), [enumerated], NOW)).toEqual({
        decision: 'auto',
        grantId: 'auto-set',
      });
    });

    it('a whitespace-only data_class does not count as naming a class', () => {
      // canonicalDataClass('  ') is null, so this must behave like data_class NULL
      // rather than like a class literally named "  ".
      const blank = grant({ id: 'auto-blank', mode: 'auto', dataClass: '   ' });

      expect(evaluateGrant(ask({ dataClass: 'medical-records' }), [blank], NOW).decision).toBe('review');
    });

    it('a matching explicit `review` grant is preferred as the basis over a downgraded auto', () => {
      const grants = [
        grant({ id: 'auto-wild', mode: 'auto', dataClass: null }),
        grant({ id: 'review-explicit', mode: 'review', dataClass: null }),
      ];

      expect(evaluateGrant(ask({ dataClass: 'beach' }), grants, NOW)).toEqual({
        decision: 'review',
        grantId: 'review-explicit',
      });
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

  // DEFECTS 3 + 4 — `revoked_at` is an event, `expires_at` is the schedule.
  describe('revocation vs expiry', () => {
    it('SECURITY: a FUTURE revokedAt is revoked, not "scheduled"', () => {
      // This used to evaluate to `auto`: the matcher read a future `revoked_at`
      // as a pending expiry. Every SQL read path filters `revoked_at IS NULL`,
      // so the database already considered such a grant gone — two readers of
      // the same column disagreeing about whether consent stands. The branch is
      // deleted; `expiresAt` below is the real schedule.
      const future = grant({ mode: 'auto', revokedAt: new Date('2026-07-16T00:00:00Z') });
      expect(evaluateGrant(ask(), [future], NOW)).toEqual({ decision: 'review' });
    });

    it('honours a future expiresAt as still active', () => {
      const live = grant({ mode: 'auto', expiresAt: new Date('2026-12-31T00:00:00Z') });
      expect(evaluateGrant(ask(), [live], NOW)).toEqual({ decision: 'auto', grantId: 'grant-1' });
    });

    it('SECURITY: ignores a grant whose expiresAt has passed', () => {
      const lapsed = grant({ mode: 'auto', expiresAt: new Date('2026-07-14T00:00:00Z') });
      expect(evaluateGrant(ask(), [lapsed], NOW)).toEqual({ decision: 'review' });
    });

    it('isGrantActive is the single liveness predicate the SQL paths reuse', () => {
      expect(isGrantActive(grant(), NOW)).toBe(true);
      expect(isGrantActive(grant({ revokedAt: new Date('2026-07-14T00:00:00Z') }), NOW)).toBe(false);
      expect(isGrantActive(grant({ revokedAt: new Date('2026-07-16T00:00:00Z') }), NOW)).toBe(false);
      expect(isGrantActive(grant({ expiresAt: new Date('2026-07-14T00:00:00Z') }), NOW)).toBe(false);
      expect(isGrantActive(grant({ expiresAt: new Date('2026-07-16T00:00:00Z') }), NOW)).toBe(true);
      // Expiry exactly at `now` has already passed.
      expect(isGrantActive(grant({ expiresAt: NOW }), NOW)).toBe(false);
    });
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

    // A grant that declares no ceiling genuinely imposes none of its own —
    // only the tier ceiling applies. That is the ONLY nullish case.
    const uncapped = grant({ mode: 'auto', scope: { dataClasses: ['photos'] } });
    expect(evaluateGrant(ask(), [uncapped], NOW).maxDisclosure).toBeUndefined();
  });

  /**
   * An unreadable restriction is the STRICTEST reading of it, not the absence
   * of one.
   *
   * `scope` is jsonb, so `maxDisclosure` can hold anything. This used to
   * validate against the rung list and return `undefined` on a miss — which
   * discards the field before `minRung` can fail closed on it, so a grant
   * reading `maxDisclosure: 'summry'` disclosed MORE than the identical grant
   * reading `'summary'`. A typo in the owner's own cap must not be the loosest
   * interpretation of it.
   */
  describe('an unrecognised maxDisclosure fails CLOSED', () => {
    it.each(['everything', 'bogus', 'summry', '', '   ', 42, true])('clamps to none for %p', (value) => {
      const bogus = grant({ mode: 'auto', scope: { maxDisclosure: value as never } });
      expect(evaluateGrant(ask(), [bogus], NOW).maxDisclosure).toBe('none');
    });

    it('treats an ABSENT ceiling as no ceiling, not as a typo', () => {
      // `null`/omitted is the one nullish case that must stay nullish: the
      // grant declares nothing, so only the tier ceiling applies.
      const g = grant({ mode: 'auto', scope: { maxDisclosure: null as never } });
      expect(evaluateGrant(ask(), [g], NOW).maxDisclosure).toBeUndefined();
    });

    it('still recovers a rung the owner merely mis-cased or padded', () => {
      // Canonicalizing here can only ever RECOVER intent: the fallback beneath
      // it is already the tightest rung on the ladder.
      for (const value of ['Full', 'COUNT', ' summary ']) {
        const g = grant({ mode: 'auto', scope: { maxDisclosure: value as never } });
        expect(evaluateGrant(ask(), [g], NOW).maxDisclosure).toBe(value.trim().toLowerCase());
      }
    });
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

/**
 * ═══ A BLOCK GRANT WAS EVADABLE BY CASING AND PADDING ═══
 *
 * `classMatchesQuery` and `blockCoversQuery` compared the two `queryType`
 * strings RAW, while `dataClass` beside them went through `canonicalDataClass`.
 * canonical.ts already carried the rule — "any normalization added here MUST be
 * mirrored by every consumer" — and it was never applied to the field next
 * door. Reproduced: a block on `photos` denied `photos` and let `Photos` and
 * `'photos '` through to REVIEW, from where a broad `auto` grant or a tired tap
 * answers them. A zero-width space in `dataClass` evaded a class-pinned block
 * the same way.
 *
 * The asker supplies both strings, so both are hostile input, and both are now
 * canonicalized on BOTH sides.
 */
describe('a block cannot be evaded by respelling the query', () => {
  const blocked = grant({ id: 'blk', mode: 'block', queryType: 'photos', dataClass: null });

  it.each(['photos', 'Photos', 'PHOTOS', 'photos ', ' photos', 'photos\u00a0', '\ufeffphotos'])(
    'denies queryType %j',
    (queryType) => {
      expect(evaluateGrant(ask({ queryType }), [blocked], NOW).decision).toBe('deny');
    },
  );

  it('does not over-match a genuinely different archetype', () => {
    // The canonicalizer folds spelling, not meaning — a block on `photos` still
    // says nothing about `calendar`.
    expect(evaluateGrant(ask({ queryType: 'calendar' }), [blocked], NOW).decision).toBe('review');
  });

  const classBlocked = grant({ id: 'blk2', mode: 'block', queryType: 'photos', dataClass: 'photos' });

  it.each([
    'photos',
    'Photos',
    'photos ',
    'pho\u200btos',
    'photos\u200b',
    '\uff50\uff48\uff4f\uff54\uff4f\uff53',
  ])('denies dataClass %j against a class-pinned block', (dataClass) => {
    expect(evaluateGrant(ask({ queryType: 'photos', dataClass }), [classBlocked], NOW).decision).toBe('deny');
  });

  it('closes the same hole on the POSITIVE path, so a respelt ask cannot ride a broad auto grant', () => {
    // The other half of the evasion: `Photos` used to miss the block AND miss
    // the auto grant, landing in review. It must now match both — and the block
    // wins, because a matching block always does.
    const auto = grant({ id: 'a', mode: 'auto', queryType: 'photos', dataClass: 'photos' });

    expect(evaluateGrant(ask({ queryType: 'Photos', dataClass: 'PHOTOS' }), [auto], NOW)).toMatchObject({
      decision: 'auto',
      grantId: 'a',
    });
    expect(
      evaluateGrant(ask({ queryType: 'Photos', dataClass: 'PHOTOS' }), [auto, classBlocked], NOW).decision,
    ).toBe('deny');
  });

  it('canonicalizes the archetype scope the same way, not with its own trim/lowercase', () => {
    const scoped = grant({
      id: 's',
      mode: 'auto',
      queryType: 'photos',
      dataClass: 'photos',
      scope: { archetypes: ['Photos'] },
    });

    expect(evaluateGrant(ask({ queryType: 'photos', dataClass: 'photos' }), [scoped], NOW).decision).toBe(
      'auto',
    );
  });
});
