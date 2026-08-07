import { parseMemoryEntries, memoryShapeHints, memoryTitle, unwrapMemoryList } from '../_ai_memory';

describe('_ai_memory: unwrapMemoryList', () => {
  it('accepts a bare array', () => {
    expect(unwrapMemoryList(['a'])).toEqual(['a']);
  });

  it('accepts known wrapper keys', () => {
    expect(unwrapMemoryList({ memories: ['a'] })).toEqual(['a']);
    expect(unwrapMemoryList({ saved_info: ['a'] })).toEqual(['a']);
    expect(unwrapMemoryList({ savedInfo: ['a'] })).toEqual(['a']);
    expect(unwrapMemoryList({ entries: ['a'] })).toEqual(['a']);
  });

  it('rejects non-lists', () => {
    expect(unwrapMemoryList(undefined)).toBeUndefined();
    expect(unwrapMemoryList('text')).toBeUndefined();
    expect(unwrapMemoryList({ someOtherShape: { nested: true } })).toBeUndefined();
    expect(unwrapMemoryList({ memories: 'not an array' })).toBeUndefined();
  });
});

describe('_ai_memory: parseMemoryEntries', () => {
  it('normalizes bare-string entries and trims whitespace', () => {
    const entries = parseMemoryEntries(['  likes tea  ', '', '   ']);
    expect(entries).toEqual([{ text: 'likes tea' }]);
  });

  it('prefers content over text over summary for the entry body', () => {
    expect(parseMemoryEntries([{ content: 'c', text: 't', summary: 's' }])[0].text).toBe('c');
    expect(parseMemoryEntries([{ text: 't', summary: 's' }])[0].text).toBe('t');
    expect(parseMemoryEntries([{ summary: 's' }])[0].text).toBe('s');
    expect(parseMemoryEntries([{ value: 'v' }])[0].text).toBe('v');
  });

  it('skips entries with no usable text', () => {
    expect(parseMemoryEntries([{ id: 'x' }, 42, null, { content: '   ' }])).toEqual([]);
  });

  it('parses epoch seconds, epoch millis, and numeric-string timestamps', () => {
    const secs = parseMemoryEntries([{ content: 'a', created_at: 1740787200 }])[0];
    expect(secs.created).toEqual(new Date('2025-03-01T00:00:00.000Z'));
    const millis = parseMemoryEntries([{ content: 'a', created_at: 1740787200000 }])[0];
    expect(millis.created).toEqual(new Date('2025-03-01T00:00:00.000Z'));
    const numStr = parseMemoryEntries([{ content: 'a', created_at: '1740787200' }])[0];
    expect(numStr.created).toEqual(new Date('2025-03-01T00:00:00.000Z'));
  });

  it('parses ISO timestamps and alternate created/updated key spellings', () => {
    const e1 = parseMemoryEntries([
      { content: 'a', create_time: '2026-03-05T12:00:00Z', update_time: '2026-03-06T12:00:00Z' },
    ])[0];
    expect(e1.created).toEqual(new Date('2026-03-05T12:00:00Z'));
    expect(e1.updated).toEqual(new Date('2026-03-06T12:00:00Z'));
    const e2 = parseMemoryEntries([{ content: 'a', created: '2026-03-15T10:00:00Z' }])[0];
    expect(e2.created).toEqual(new Date('2026-03-15T10:00:00Z'));
  });

  it('ignores unparseable timestamps rather than producing Invalid Date', () => {
    const e = parseMemoryEntries([{ content: 'a', created_at: 'yesterday-ish', updated_at: -5 }])[0];
    expect(e.created).toBeUndefined();
    expect(e.updated).toBeUndefined();
  });

  it('carries id/uuid as idHint (numbers stringified) and category/topic', () => {
    expect(parseMemoryEntries([{ content: 'a', id: 'mem-1' }])[0].idHint).toBe('mem-1');
    expect(parseMemoryEntries([{ content: 'a', id: 7 }])[0].idHint).toBe('7');
    expect(parseMemoryEntries([{ content: 'a', uuid: 'u-1' }])[0].idHint).toBe('u-1');
    expect(parseMemoryEntries([{ content: 'a', category: 'prefs' }])[0].category).toBe('prefs');
    expect(parseMemoryEntries([{ content: 'a', topic: 'travel' }])[0].category).toBe('travel');
  });

  it('returns [] for values that are not memory lists at all', () => {
    expect(parseMemoryEntries(undefined)).toEqual([]);
    expect(parseMemoryEntries({ mapping: {} })).toEqual([]);
    expect(parseMemoryEntries('just a string')).toEqual([]);
  });

  it('splits a conversations_memory profile blob into one entry per **Section**', () => {
    const entries = parseMemoryEntries([
      {
        conversations_memory:
          '**Work context**\n\nBuilds pipelines.\n\n**Top of mind**\n\nShip the migration.',
        account_uuid: 'acc-1',
      },
    ]);
    expect(entries).toEqual([
      {
        text: 'Builds pipelines.',
        category: 'Work context',
        title: 'Work context',
        idHint: 'acc-1:work-context',
      },
      {
        text: 'Ship the migration.',
        category: 'Top of mind',
        title: 'Top of mind',
        idHint: 'acc-1:top-of-mind',
      },
    ]);
  });

  it('profile idHint keys off account + section, not content (stable across edits)', () => {
    const parse = (body: string) =>
      parseMemoryEntries([{ conversations_memory: `**Work context**\n${body}`, account_uuid: 'acc-1' }]);
    expect(parse('v1').map((e) => e.idHint)).toEqual(parse('v2 edited').map((e) => e.idHint));
  });

  it('headerless profile blobs become a single general entry; duplicate sections get distinct ids', () => {
    expect(
      parseMemoryEntries([{ conversations_memory: 'Just one paragraph.', account_uuid: 'acc-1' }]),
    ).toEqual([
      { text: 'Just one paragraph.', category: undefined, title: undefined, idHint: 'acc-1:general' },
    ]);
    const dup = parseMemoryEntries([{ conversations_memory: '**Notes**\na\n**Notes**\nb' }]);
    expect(dup.map((e) => e.idHint)).toEqual(['profile:notes', 'profile:notes-2']);
  });
});

describe('_ai_memory: memoryShapeHints', () => {
  it('flags numeric timestamps (ChatGPT-style)', () => {
    const h = memoryShapeHints({ memories: [{ content: 'a', created_at: 1740787200 }] });
    expect(h).toEqual({ numericTimes: true, isoTimes: false, uuids: false });
  });

  it('flags ISO timestamps and uuids (Claude-style)', () => {
    const h = memoryShapeHints([{ uuid: 'u-1', content: 'a', created_at: '2026-03-05T12:00:00Z' }]);
    expect(h).toEqual({ numericTimes: false, isoTimes: true, uuids: true });
  });

  it('numeric-string timestamps count as numeric, not ISO', () => {
    const h = memoryShapeHints([{ content: 'a', created_at: '1740787200' }]);
    expect(h.isoTimes).toBe(false);
  });

  it('bare strings carry no hints', () => {
    expect(memoryShapeHints(['a', 'b'])).toEqual({ numericTimes: false, isoTimes: false, uuids: false });
  });

  it('account_uuid counts as a uuid hint (profile-shaped memories.json)', () => {
    const h = memoryShapeHints([{ conversations_memory: '**A**\nx', account_uuid: 'acc-1' }]);
    expect(h.uuids).toBe(true);
  });
});

describe('_ai_memory: memoryTitle', () => {
  it('passes short single-line text through', () => {
    expect(memoryTitle('likes tea')).toBe('likes tea');
  });

  it('uses only the first line of multi-line text', () => {
    expect(memoryTitle('first line\nsecond line')).toBe('first line');
  });

  it('truncates long text with an ellipsis at the cap', () => {
    const long = 'x'.repeat(200);
    const t = memoryTitle(long);
    expect(t.length).toBe(80);
    expect(t.endsWith('…')).toBe(true);
  });
});
