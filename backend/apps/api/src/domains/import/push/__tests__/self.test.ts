import {
  makeIsSelf,
  NOBODY_IS_SELF,
  readSelfIdentity,
  type SelfIdentity,
  type SelfIdentityReader,
} from '../self';

/**
 * The predicate that decides whether a chat message is one the owner SENT.
 *
 * WhatsApp and Messenger exports carry no is-from-me column, so this is the
 * only thing standing between "the owner's 437 sent messages" and "4,205
 * messages, all inbound". Two properties matter more than any individual match
 * rule: it must be built once (a run is hundreds of thousands of records), and
 * it must fail to `false` — never to `true`, and never by throwing — because a
 * wrong `true` writes a false authorship claim into somebody's memory.
 */

function identity(over: Partial<SelfIdentity> = {}): SelfIdentity {
  return { names: ['Liam Broza'], email: 'liam.broza@example.com', ...over };
}

describe('makeIsSelf', () => {
  it('matches the owner exactly, and past case, diacritics and punctuation', () => {
    const isSelf = makeIsSelf(identity());

    expect(isSelf('Liam Broza')).toBe(true);
    expect(isSelf('liam  broza')).toBe(true);
    expect(isSelf('Líam Broza')).toBe(true);
    expect(isSelf('Broza, Liam')).toBe(true);
  });

  it('matches a shortened or padded form of the same name', () => {
    const isSelf = makeIsSelf(identity());

    // Token containment either way: WhatsApp shows whatever the owner set as
    // their profile name, which is routinely just the first name.
    expect(isSelf('Liam')).toBe(true);
    expect(isSelf('Liam A Broza')).toBe(true);
    // One edit — under the similarity floor rather than an exact match.
    expect(isSelf('Liam Brozer')).toBe(true);
  });

  it('falls back to the email local part when the account has no name', () => {
    const isSelf = makeIsSelf(identity({ names: [] }));

    expect(isSelf('Liam Broza')).toBe(true);
  });

  it('reads the self Person row as well as the account name', () => {
    // The name onboarding let the owner choose, which is often not the name
    // their identity provider handed over.
    const isSelf = makeIsSelf({ names: ['lbroza', 'Liam Broza'], email: null });

    expect(isSelf('Liam Broza')).toBe(true);
  });

  it('does not claim other people', () => {
    const isSelf = makeIsSelf(identity());

    expect(isSelf('Alice Example')).toBe(false);
    expect(isSelf('Bob Sample')).toBe(false);
    expect(isSelf('Dana Broza')).toBe(false);
    expect(isSelf('')).toBe(false);
    // A lone initial is not a name: without the substantial-token anchor in
    // containsAll it would be a subset of every name containing it.
    expect(isSelf('L')).toBe(false);
  });

  it('is NOBODY_IS_SELF when there is nothing to match against', () => {
    // The fail-safe. No name and no email is not an error and not a guess: the
    // caller keeps the inbound default it had before this predicate existed.
    expect(makeIsSelf({ names: [], email: null })).toBe(NOBODY_IS_SELF);
    expect(makeIsSelf({ names: ['   '], email: null })).toBe(NOBODY_IS_SELF);
    expect(NOBODY_IS_SELF('Liam Broza')).toBe(false);
  });
});

describe('readSelfIdentity', () => {
  /** A SelfIdentityReader over fixed rows, recording what it was asked. */
  function readerFor(rows: Array<{ name: string | null; email: string | null }>) {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const db: SelfIdentityReader = {
      query: (async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });

        return rows;
      }) as SelfIdentityReader['query'],
    };

    return { db, calls };
  }

  it('collects every name row and the first non-empty email', async () => {
    const { db, calls } = readerFor([
      { name: null, email: 'liam.broza@example.com' },
      { name: 'Liam Broza', email: null },
    ]);

    await expect(readSelfIdentity(db, 'user-1')).resolves.toEqual({
      names: ['Liam Broza'],
      email: 'liam.broza@example.com',
    });
    expect(calls[0].params).toEqual(['user-1']);
  });

  it('asks for the account row and the un-merged is_self Person, in one round-trip', async () => {
    const { db, calls } = readerFor([]);

    await readSelfIdentity(db, 'user-1');

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('FROM ci.users u');
    expect(calls[0].sql).toContain("e.entity_type = 'Person'");
    // Both spellings of the flag: the typed column and the pre-migration key.
    expect(calls[0].sql).toContain('e.is_self IS TRUE');
    expect(calls[0].sql).toContain("e.properties ->> 'is_self' = 'true'");
    // A merge tombstone keeps its name; it must not answer for the owner.
    expect(calls[0].sql).toContain('e.merged_into_entity_id IS NULL');
  });

  it('yields an empty identity for a user with no rows at all', async () => {
    const { db } = readerFor([]);

    await expect(readSelfIdentity(db, 'user-1')).resolves.toEqual({ names: [], email: null });
  });
});
