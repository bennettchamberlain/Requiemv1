import { describe, expect, it } from 'vitest';

import {
  grantLabel,
  itemLabel,
  knownAskerLabel,
  partyLabel,
  scopeSummary,
  searchBreadthNote,
} from './askBinding';

describe('searchBreadthNote', () => {
  /**
   * The executor maps a handful of data classes onto entity-type filters and
   * runs UNFILTERED for everything else. The card must never let the owner read
   * the declared class as a narrower scope than the search that runs.
   */
  it('warns that an unmapped class searches everything', () => {
    const note = searchBreadthNote({ dataClass: 'location' });

    expect(note).toMatch(/every kind of thing in your memory/i);
    expect(note).toContain('location');
  });

  it('says so when the ask names no class at all', () => {
    expect(searchBreadthNote({})).toMatch(/every kind of thing in your memory/i);
    expect(searchBreadthNote({ dataClass: null })).toMatch(/every kind of thing in your memory/i);
  });

  it('never promises a narrowing, even for a class the backend does map', () => {
    // `photos` IS in the executor's hint table today. The note still declines to
    // assert the narrowing, because a mirrored copy of that table here would go
    // stale in the one direction that matters — claiming narrow while the search
    // widened. Over-stating breadth is safe; under-stating it never is.
    expect(searchBreadthNote({ dataClass: 'photos' })).toMatch(/every kind of thing in your memory/i);
  });
});

describe('opaque id presentation', () => {
  it('marks a shortened id as a truncation rather than as a name', () => {
    // "Peer __devon" read as corrupted text; the ellipsis says characters
    // precede it, which is what makes the same fragment read as an id.
    expect(partyLabel(null, 'user_globaluid__devon')).toBe('Peer …_devon');
    expect(partyLabel(null, 'globaluid-abc123')).toBe('Peer …abc123');
    expect(itemLabel({ id: 'file-globaluid-a3f2b1', type: 'photo' })).toBe('photo …a3f2b1');
  });

  it('keeps the fragment a faithful suffix, punctuation and all', () => {
    // Nothing is trimmed off the front of the slice. Dropping the leading `_`
    // would both shorten the discriminating tail and turn "…_devon" into
    // "…devon", which reads like a name — the one thing this must never do.
    expect(partyLabel(null, 'xxxxr_maya')).toBe('Peer …r_maya');
    expect(partyLabel(null, 'aaaaaabbbbbb')).toBe('Peer …bbbbbb');
    expect(partyLabel(null, 'user_globaluid__devon')).toContain('_devon');
  });

  it('prefers a real handle, and admits when there is nothing at all', () => {
    expect(partyLabel('maya@example.social', 'globaluid-abc123')).toBe('maya@example.social');
    expect(partyLabel(null, null)).toBe('Unknown');
  });
});

describe('scopeSummary and grantLabel', () => {
  it('renders exactly what the wire carries', () => {
    expect(scopeSummary({ queryType: 'photos', dataClass: 'photos' })).toBe('photos · photos');
    expect(scopeSummary({ queryType: 'availability' })).toBe('availability');
    expect(grantLabel('photos', null)).toBe('photos · all classes');
  });

  it('reports the only trust fact on the wire without inventing a tier', () => {
    expect(knownAskerLabel('grant-1')).toBe('known contact');
    expect(knownAskerLabel(null)).toBe('no standing grant');
  });
});
