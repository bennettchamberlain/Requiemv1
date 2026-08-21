import {
  applyDisclosureCeiling,
  disclosureCeiling,
  minRung,
  narrowerForm,
  rungAtLeast,
  rungForForm,
} from './policy';
import type { DisclosedAnswer } from './types';

function answer(overrides: Partial<DisclosedAnswer> = {}): DisclosedAnswer {
  return {
    form: 'retrieval',
    items: [
      { id: 'a', type: 'file' },
      { id: 'b', type: 'file' },
    ],
    disclosedCount: 2,
    withheldCount: 1,
    summary: 'They shared 2 items.',
    consentBasis: 'grant-1',
    ...overrides,
  };
}

describe('rung ordering', () => {
  it('orders the ladder coarsest-first', () => {
    expect(rungAtLeast('full', 'boolean')).toBe(true);
    expect(rungAtLeast('boolean', 'full')).toBe(false);
    expect(rungAtLeast('summary', 'summary')).toBe(true);
    expect(minRung('full', 'count')).toBe('count');
    expect(minRung('none', 'boolean')).toBe('none');
  });
});

describe('disclosureCeiling', () => {
  it('gives household and family the widest ceiling', () => {
    expect(disclosureCeiling('household', 'photos')).toBe('full');
    expect(disclosureCeiling('family', 'photos')).toBe('full');
  });

  it('tightens as trust decreases', () => {
    expect(disclosureCeiling('trusted', 'photos')).toBe('redacted');
    expect(disclosureCeiling('peer', 'photos')).toBe('redacted');
    expect(disclosureCeiling('peer', 'documents')).toBe('summary');
    expect(disclosureCeiling('stranger', 'photos')).toBe('boolean');
  });

  it('caps sensitive classes at none below family, forcing owner review', () => {
    for (const cls of ['health', 'medical', 'financial', 'secrets', 'location']) {
      expect(disclosureCeiling('stranger', cls)).toBe('none');
      expect(disclosureCeiling('peer', cls)).toBe('none');
      expect(disclosureCeiling('trusted', cls)).toBe('none');
    }

    // household/family may still receive them (subject to a grant)
    expect(disclosureCeiling('family', 'health')).not.toBe('none');
  });

  it('canonicalizes the class so casing cannot evade the sensitive cap', () => {
    expect(disclosureCeiling('stranger', '  HEALTH  ')).toBe('none');
  });

  it('falls back to the strictest posture for an unknown tier', () => {
    expect(disclosureCeiling('nonsense' as never, 'photos')).toBe('boolean');
  });
});

describe('applyDisclosureCeiling', () => {
  it('leaves an answer alone when the ceiling is at or above its natural rung', () => {
    expect(applyDisclosureCeiling(answer(), 'full')).toEqual(answer());
  });

  /**
   * `redacted` sits BELOW `full`, and it used to return the same object — the
   * clamp read `if (effective === 'full' || effective === 'redacted') return
   * answer`, so a grant capped at "share only what I kept" disclosed exactly as
   * much as one with no cap at all. A rung that clamps nothing is not a rung;
   * it is a label the owner can pick believing it does something.
   */
  describe('redacted is strictly below full', () => {
    it('keeps the kept references but stops reporting how many were withheld', () => {
      const clamped = applyDisclosureCeiling(answer(), 'redacted');

      // The owner's redaction was already applied upstream, so what they kept
      // still crosses…
      expect(clamped.items).toEqual(answer().items);
      // …but "and there were N more" is its own disclosure, and `redacted`
      // means the asker learns nothing about the rest.
      expect(clamped.withheldCount).toBe(0);
      expect(answer().withheldCount).toBeGreaterThan(0);
    });

    it('discloses strictly less than full for the same answer', () => {
      const atFull = applyDisclosureCeiling(answer(), 'full');
      const atRedacted = applyDisclosureCeiling(answer(), 'redacted');

      expect(atRedacted).not.toEqual(atFull);
      expect(atRedacted.withheldCount).toBeLessThan(atFull.withheldCount);
    });
  });

  it('drops item references at summary and below', () => {
    for (const rung of ['summary', 'count', 'boolean', 'none'] as const) {
      expect(applyDisclosureCeiling(answer(), rung).items).toEqual([]);
    }
  });

  it('zeroes withheldCount once items are hidden (it is itself a signal)', () => {
    expect(applyDisclosureCeiling(answer(), 'summary').withheldCount).toBe(0);
    expect(applyDisclosureCeiling(answer(), 'count').withheldCount).toBe(0);
  });

  it('collapses to yes/no at boolean without revealing how many', () => {
    const clamped = applyDisclosureCeiling(answer({ disclosedCount: 7 }), 'boolean');
    expect(clamped.disclosedCount).toBe(1);
    expect(clamped.summary).toBe('Yes.');
    expect(applyDisclosureCeiling(answer({ disclosedCount: 0 }), 'boolean').summary).toBe('No.');
  });

  it('discloses nothing at none', () => {
    const clamped = applyDisclosureCeiling(answer({ disclosedCount: 9 }), 'none');
    expect(clamped).toMatchObject({ items: [], disclosedCount: 0, withheldCount: 0 });
    expect(clamped.summary).toBe('Nothing was shared.');
  });

  it('never widens: a boolean-form answer stays boolean even under a full ceiling', () => {
    const boolAnswer = answer({ form: 'boolean', items: [] });
    expect(applyDisclosureCeiling(boolAnswer, 'full').items).toEqual([]);
    expect(rungForForm('boolean')).toBe('boolean');
  });
});

/**
 * The owner's choice of form is a LIMIT, not a selector. If it could raise the
 * rung, the argument that exists to let the responder share less would become a
 * way for a caller to share more than the ask's own archetype implies.
 */
describe('narrowerForm', () => {
  it('takes the owner’s form when it discloses less', () => {
    expect(narrowerForm('boolean', 'retrieval')).toBe('boolean');
    expect(narrowerForm('existence', 'retrieval')).toBe('existence');
    expect(narrowerForm('attribute', 'retrieval')).toBe('attribute');
  });

  it('keeps the inferred form when the owner’s would disclose MORE', () => {
    expect(narrowerForm('retrieval', 'boolean')).toBe('boolean');
    expect(narrowerForm('attribute', 'existence')).toBe('existence');
    expect(narrowerForm('existence', 'boolean')).toBe('boolean');
  });

  it('gives a tie to the owner, who is the one expressing intent', () => {
    // Both sit on the `boolean` rung; the wording the asker sees differs.
    expect(narrowerForm('identity', 'boolean')).toBe('identity');
    expect(narrowerForm('boolean', 'identity')).toBe('boolean');
  });
});
