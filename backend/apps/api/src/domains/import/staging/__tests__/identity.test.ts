import type { Entity, Item } from '../../datasources/timeline';
import {
  entityIdentityKey,
  entityKey,
  hasContactIdentity,
  hashItem,
  mergeAccumulatedMetadata,
  needsContentDigest,
  normalizeHandle,
  resolveEntityType,
} from '../identity';

/**
 * These functions decide what collapses into what, which is the whole of
 * within-run dedup. Every case here is one a real export produced:
 *
 *  - one photo replicated across three album folders must stage once;
 *  - one person spelled three ways in a mailbox must stage once;
 *  - two genuinely different things must NOT collapse, which is the half that
 *    silently loses data when it goes wrong.
 */

describe('normalizeHandle', () => {
  it('lower-cases an email so display casing cannot fork a person', () => {
    expect(normalizeHandle('Alice@Example.COM')).toBe('alice@example.com');
  });

  it('reduces a phone number to its last ten digits, whatever the formatting', () => {
    const forms = ['+1 (555) 010-9999', '555-010-9999', '15550109999', '+1.555.010.9999'];

    expect(new Set(forms.map(normalizeHandle)).size).toBe(1);
    expect(normalizeHandle(forms[0])).toBe('5550109999');
  });

  it('rejects a bare name and a too-short number — neither identifies anyone', () => {
    expect(normalizeHandle('Alice Smith')).toBe('');
    expect(normalizeHandle('12345')).toBe('');
    expect(normalizeHandle('')).toBe('');
    expect(normalizeHandle(undefined)).toBe('');
  });
});

describe('entityIdentityKey', () => {
  it('is independent of attribute order, so from/to/cc surface one person the same way', () => {
    const asFrom: Entity = {
      name: 'Alice',
      attributes: [
        { name: 'email', value: 'alice@example.com' },
        { name: 'phone', value: '+1 555 010 9999' },
      ],
    };
    const asRecipient: Entity = {
      name: 'Alice Smith',
      attributes: [
        { name: 'phone', value: '555-010-9999' },
        { name: 'email', value: 'ALICE@example.com' },
      ],
    };

    expect(entityIdentityKey(asFrom)).toBe(entityIdentityKey(asRecipient));
  });

  it('reads an identity-flagged attribute that carries no recognisable name', () => {
    // apple_contacts emits exactly this shape.
    const entity: Entity = { attributes: [{ name: '', value: '+1 555 010 9999', identity: true }] };

    expect(entityIdentityKey(entity)).toBe('5550109999');
  });

  it('is null for an entity with no handle at all', () => {
    expect(entityIdentityKey({ name: 'European Vacation', type: 'album' })).toBeNull();
  });
});

describe('resolveEntityType', () => {
  it('defaults a handle-carrying entity to contact when the parser omitted a type', () => {
    expect(resolveEntityType({ attributes: [{ name: 'email', value: 'a@b.com' }] })).toBe('contact');
  });

  it('never overrides a type the parser did set', () => {
    expect(
      resolveEntityType({ type: 'organization', attributes: [{ name: 'email', value: 'a@b.com' }] }),
    ).toBe('organization');
  });

  it('leaves the type of a handle-less entity alone, including when it is absent', () => {
    expect(resolveEntityType({ name: 'Paris' })).toBeNull();
    expect(hasContactIdentity({ name: 'Paris' })).toBe(false);
  });
});

describe('hashItem', () => {
  const photo = (folder: string): Item => ({
    classification: 'photo',
    timestamp: new Date('2012-07-04T10:00:00Z'),
    content: { filename: 'IMAG0262.jpg' },
    intermediateLocation: folder,
  });

  it('collapses one photo replicated across album folders — the Takeout case', () => {
    // The path is deliberately NOT hashed. With it, this file staged three times
    // and reached the server as three events.
    expect(hashItem(photo('European Vacation/'), 'google_photos')).toBe(
      hashItem(photo('Photos from 2012/'), 'google_photos'),
    );
  });

  it('keeps genuinely different content apart', () => {
    const base = photo('Album/');
    const renamed: Item = { ...base, content: { filename: 'IMAG0263.jpg' } };
    const later: Item = { ...base, timestamp: new Date('2012-07-05T10:00:00Z') };

    expect(hashItem(renamed, 'google_photos')).not.toBe(hashItem(base, 'google_photos'));
    expect(hashItem(later, 'google_photos')).not.toBe(hashItem(base, 'google_photos'));
  });

  it('separates the same file arriving from two sources', () => {
    expect(hashItem(photo('Album/'), 'google_photos')).not.toBe(hashItem(photo('Album/'), 'icloud'));
  });

  it('prefers the parser own id when it has one', () => {
    expect(hashItem({ id: 'gmail-msg-1', classification: 'email' }, 'gmail')).toBe('gmail-msg-1');
  });

  it('distinguishes items by coordinates when nothing else differs', () => {
    const here: Item = { classification: 'visit', location: { latitude: 1, longitude: 2 } };
    const there: Item = { classification: 'visit', location: { latitude: 3, longitude: 4 } };

    expect(hashItem(here, 'google_location')).not.toBe(hashItem(there, 'google_location'));
  });

  /**
   * The degenerate fallback — no parser id, no timestamp, no coordinates —
   * which is not an edge case: 79,906 of 80,067 `generic` rows in a real 462k
   * run carried no timestamp, and 24 parsers assign no id at all.
   *
   * Reproduced live before the fix: `AliceThread/note.txt` (25 bytes) and
   * `BobThread/note.txt` (29 bytes) in one unit staged as ONE row. The 29-byte
   * file was consumed by the unpack's rename and deleted with the run's scratch
   * tree, leaving no record of it anywhere but an `itemsDeduped` tick.
   */
  describe('when the item has neither a timestamp nor coordinates', () => {
    const note = (folder: string): Item => ({
      classification: 'note',
      content: { filename: 'note.txt' },
      intermediateLocation: `${folder}/note.txt`,
    });

    it('keeps two same-named files in different folders apart', () => {
      expect(hashItem(note('AliceThread'), 'generic')).not.toBe(hashItem(note('BobThread'), 'generic'));
    });

    it('prefers the content digest, so identical bytes still collapse across folders', () => {
      // The album-replication guarantee, preserved for items that have no
      // timestamp to collapse on: same bytes, two paths, one staged row.
      expect(hashItem(note('European Vacation'), 'google_photos', 'deadbeef')).toBe(
        hashItem(note('Photos from 2012'), 'google_photos', 'deadbeef'),
      );
    });

    it('separates different bytes at the same path', () => {
      expect(hashItem(note('Thread'), 'generic', 'aaaa')).not.toBe(
        hashItem(note('Thread'), 'generic', 'bbbb'),
      );
    });

    it('falls back to the metadata for a record that carries no file at all', () => {
      const record = (body: string): Item => ({ classification: 'note', metadata: { body } });

      expect(hashItem(record('one'), 'generic')).not.toBe(hashItem(record('two'), 'generic'));
    });
  });

  it('leaves the hash of every non-degenerate item exactly as it was', () => {
    // The fold-in must not reach items that already key on something real, or
    // an in-flight run's staged rows would stop matching their own dedup index.
    const dated: Item = {
      classification: 'photo',
      timestamp: new Date('2012-07-04T10:00:00Z'),
      content: { filename: 'IMAG0262.jpg' },
      intermediateLocation: 'European Vacation/IMAG0262.jpg',
    };
    const elsewhere: Item = { ...dated, intermediateLocation: 'Photos from 2012/IMAG0262.jpg' };

    expect(hashItem(dated, 'google_photos', 'aaaa')).toBe(hashItem(elsewhere, 'google_photos', 'bbbb'));
  });
});

describe('needsContentDigest', () => {
  it('is true only when nothing else identifies the item', () => {
    expect(needsContentDigest({ classification: 'note', content: { filename: 'note.txt' } })).toBe(true);
  });

  it('is false as soon as a parser id, a timestamp or a location is present', () => {
    expect(needsContentDigest({ id: 'gmail-1' })).toBe(false);
    expect(needsContentDigest({ timestamp: new Date('2012-07-04T10:00:00Z') })).toBe(false);
    expect(needsContentDigest({ location: { latitude: 1, longitude: 2 } })).toBe(false);
  });

  it('is true for an unparseable timestamp, which identifies nothing', () => {
    expect(needsContentDigest({ timestamp: new Date('not a date') })).toBe(true);
  });
});

describe('entityKey', () => {
  it('collapses display-name drift for one handle', () => {
    const short: Entity = { name: 'Alice', attributes: [{ name: 'email', value: 'a@b.com' }] };
    const long: Entity = { name: 'Alice Smith', attributes: [{ name: 'email', value: 'a@b.com' }] };

    expect(entityKey(short)).toBe(entityKey(long));
  });

  it('collapses a type-less contact onto its freshly-defaulted counterpart', () => {
    const untyped: Entity = { name: 'Thread A' };
    const typed: Entity = { type: null as unknown as string, name: 'Thread A' };

    expect(entityKey(untyped)).toBe(entityKey(typed));
  });

  it('keeps two handle-less entities with different names apart', () => {
    expect(entityKey({ name: 'Paris' })).not.toBe(entityKey({ name: 'Berlin' }));
  });
});

describe('mergeAccumulatedMetadata', () => {
  const dish: Entity = {
    name: 'Burger',
    accumulate: ['prices'],
    metadata: { prices: ['15.92'] },
  };

  it('appends a genuinely new value to what is already stored', () => {
    const merged = mergeAccumulatedMetadata({ prices: ['10.19'] }, dish);

    // Both are true — January and March — and the useful record is the set.
    expect(merged).toEqual({ prices: ['10.19', '15.92'] });
  });

  it('returns null when the sighting adds nothing, so nothing is written', () => {
    expect(mergeAccumulatedMetadata({ prices: ['15.92'] }, dish)).toBeNull();
  });

  it('leaves undeclared keys exactly as stored', () => {
    const merged = mergeAccumulatedMetadata({ prices: ['10.19'], name: 'Cheeseburger' }, dish);

    expect(merged?.name).toBe('Cheeseburger');
  });

  it('compares objects by content regardless of key order', () => {
    const order: Entity = {
      accumulate: ['orders'],
      metadata: { orders: [{ qty: 1, item: 'fries' }] },
    };

    expect(mergeAccumulatedMetadata({ orders: [{ item: 'fries', qty: 1 }] }, order)).toBeNull();
  });

  it('does nothing for an entity that declared no accumulating keys', () => {
    expect(mergeAccumulatedMetadata({ prices: ['1'] }, { metadata: { prices: ['2'] } })).toBeNull();
  });
});
