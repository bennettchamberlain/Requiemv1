import {
  PROFILE_FACT_PROPERTY_KEYS,
  PROFILE_URL_EVIDENCE,
  PROFILE_URL_PREFILTER_TOKEN,
  PROFILE_URL_SCORES,
  PROFILE_URL_SQL_PREFILTER,
  adjudicateProfileUrls,
  applyProfileVerdict,
  canonicalConnectedOn,
  extractProfileFacts,
  normalizeProfileUrl,
  profileFactsSqlObject,
  type ProfileFacts,
} from './profileUrls';

/*
 * Every slug and name here is invented. None is, or is meant to resemble, a
 * real member profile.
 */

/** The LinkedIn-CSV shape: `properties.URL` plus `ConnectedOn`. */
function csvPerson(name: string, url: string, connectedOn?: string): ProfileFacts {
  return extractProfileFacts({ URL: url, ConnectedOn: connectedOn }, name);
}

/** The vCard shape: the URL survives only as a NOTE `URL:` line. */
function vcardPerson(name: string, ...records: Array<{ url: string; connectedOn?: string }>): ProfileFacts {
  const note = records
    .map(
      ({ url, connectedOn }) =>
        `URL: ${url}\nPosition: Engineer\n${connectedOn ? `Connected On: ${connectedOn}\n` : ''}`,
    )
    .join('');

  return extractProfileFacts({ Notes: [note] }, name);
}

describe('normalizeProfileUrl', () => {
  it.each([
    ['https://www.linkedin.com/in/ada-quillfeather-7x2', 'linkedin.com/in/ada-quillfeather-7x2'],
    ['http://linkedin.com/in/ada-quillfeather-7x2', 'linkedin.com/in/ada-quillfeather-7x2'],
    ['linkedin.com/in/ada-quillfeather-7x2', 'linkedin.com/in/ada-quillfeather-7x2'],
    ['https://uk.linkedin.com/in/ada-quillfeather-7x2', 'linkedin.com/in/ada-quillfeather-7x2'],
    ['https://www.LinkedIn.com/in/Ada-QuillFeather-7X2', 'linkedin.com/in/ada-quillfeather-7x2'],
    ['https://www.linkedin.com/in/ada-quillfeather-7x2/', 'linkedin.com/in/ada-quillfeather-7x2'],
    ['  https://www.linkedin.com/in/ada-quillfeather-7x2  ', 'linkedin.com/in/ada-quillfeather-7x2'],
    [
      'https://www.linkedin.com/in/ada-quillfeather-7x2?trk=people-guest',
      'linkedin.com/in/ada-quillfeather-7x2',
    ],
    [
      'https://www.linkedin.com/in/ada-quillfeather-7x2/?originalSubdomain=uk&utm_source=share',
      'linkedin.com/in/ada-quillfeather-7x2',
    ],
    ['https://www.linkedin.com/in/ada-quillfeather-7x2#experience', 'linkedin.com/in/ada-quillfeather-7x2'],
    ['https://www.linkedin.com/in/ada-quillfeather-7x2.', 'linkedin.com/in/ada-quillfeather-7x2'],
  ])('canonicalises %s', (raw, expected) => {
    expect(normalizeProfileUrl(raw)).toBe(expected);
  });

  it('percent-decodes the slug, so an encoded and a literal copy agree', () => {
    const encoded = normalizeProfileUrl('https://www.linkedin.com/in/jos%C3%A9-quillfeather');
    const literal = normalizeProfileUrl('https://www.linkedin.com/in/josé-quillfeather');

    expect(encoded).toBe('linkedin.com/in/josé-quillfeather');
    expect(literal).toBe(encoded);
  });

  it('accepts a slug in another script, or with an emoji', () => {
    expect(normalizeProfileUrl('https://www.linkedin.com/in/%E6%9D%8E%E6%98%8E-q')).toBe(
      'linkedin.com/in/李明-q',
    );
    expect(normalizeProfileUrl('https://www.linkedin.com/in/ada%E2%9A%A1quill')).toBe(
      'linkedin.com/in/ada⚡quill',
    );
  });

  it('strips invisible format characters, so a marked and an unmarked copy agree', () => {
    // U+200E LEFT-TO-RIGHT MARK, as a contacts export pastes it.
    expect(normalizeProfileUrl('https://www.linkedin.com/in/ada-quill%E2%80%8E')).toBe(
      'linkedin.com/in/ada-quill',
    );
    expect(normalizeProfileUrl('https://www.linkedin.com/in/\u200Eada-quill')).toBe(
      'linkedin.com/in/ada-quill',
    );
  });

  it('NFC-normalises, so a decomposed accent matches a composed one', () => {
    const decomposed = normalizeProfileUrl('linkedin.com/in/jose\u0301-q');
    const composed = normalizeProfileUrl('linkedin.com/in/jos\u00e9-q');

    expect(decomposed).toBe('linkedin.com/in/jos\u00e9-q');
    expect(decomposed).toBe(composed);
  });

  it.each([
    ['a legacy /pub/ URL', 'https://www.linkedin.com/pub/ada-quillfeather/1/2b/3c4'],
    ['a company page', 'https://www.linkedin.com/company/quillfeather-labs'],
    ['a school page', 'https://www.linkedin.com/school/quillfeather-college/'],
    ['a profile/view link', 'https://www.linkedin.com/profile/view?id=12345'],
    ['a short link', 'https://lnkd.in/abc123'],
    ['the bare domain', 'https://www.linkedin.com/'],
    ['/in/ with no slug', 'https://www.linkedin.com/in/'],
    ['a sub-page of a profile', 'https://www.linkedin.com/in/ada-quillfeather-7x2/details/experience/'],
    ['another host', 'https://example.com/in/ada-quillfeather-7x2'],
    ['a lookalike host', 'https://notlinkedin.com/in/ada-quillfeather-7x2'],
    ['a slug shorter than three characters', 'https://www.linkedin.com/in/ab'],
    ['malformed percent-encoding', 'https://www.linkedin.com/in/ada%E0%A4%A'],
    ['a slug with stray punctuation inside', 'https://www.linkedin.com/in/ada,quill'],
    ['a slug with a non-breaking space inside', 'https://www.linkedin.com/in/ada%C2%A0quill'],
    ['a slug that is only a bidi mark and two letters', 'https://www.linkedin.com/in/%E2%80%8Eab'],
    ['an empty string', ''],
    ['whitespace', '   '],
  ])('refuses %s', (_label, raw) => {
    expect(normalizeProfileUrl(raw)).toBeNull();
  });

  it('refuses a non-string', () => {
    expect(normalizeProfileUrl(null)).toBeNull();
    expect(normalizeProfileUrl(42)).toBeNull();
    expect(normalizeProfileUrl({ url: 'https://www.linkedin.com/in/ada-q' })).toBeNull();
  });
});

describe('canonicalConnectedOn', () => {
  it("reads LinkedIn's DD Mon YYYY", () => {
    expect(canonicalConnectedOn('09 May 2014')).toBe('2014-05-09');
    expect(canonicalConnectedOn('9 May 2014')).toBe('2014-05-09');
    expect(canonicalConnectedOn('13 Sept 2021')).toBe('2021-09-13');
  });

  it('refuses any other shape rather than guessing which field is the day', () => {
    expect(canonicalConnectedOn('2014-05-09')).toBeNull();
    expect(canonicalConnectedOn('05/09/2014')).toBeNull();
    expect(canonicalConnectedOn('40 May 2014')).toBeNull();
    expect(canonicalConnectedOn('09 Foo 2014')).toBeNull();
    expect(canonicalConnectedOn(undefined)).toBeNull();
  });
});

describe('extractProfileFacts', () => {
  it('reads the CSV URL and its Connected On column', () => {
    const facts = csvPerson(
      'Ada Quillfeather',
      'https://www.linkedin.com/in/ada-quillfeather-7x2',
      '09 May 2014',
    );

    expect([...facts.urls]).toEqual(['linkedin.com/in/ada-quillfeather-7x2']);
    expect([...facts.connectedOn]).toEqual(['2014-05-09']);
    expect(facts.name?.family).toBe('quillfeather');
  });

  it('reads a NOTE URL line and its Connected On line', () => {
    const facts = vcardPerson('Ada Quillfeather', {
      url: 'https://www.linkedin.com/in/ada-quillfeather-7x2',
      connectedOn: '09 May 2014',
    });

    expect([...facts.urls]).toEqual(['linkedin.com/in/ada-quillfeather-7x2']);
    expect([...facts.connectedOn]).toEqual(['2014-05-09']);
  });

  it('takes only the first token of a NOTE URL line', () => {
    const facts = extractProfileFacts(
      { Notes: ['URL: https://www.linkedin.com/in/ada-quillfeather-7x2 Interim CEO'] },
      'Ada Quillfeather',
    );

    expect([...facts.urls]).toEqual(['linkedin.com/in/ada-quillfeather-7x2']);
  });

  it('ignores a profile URL mentioned in prose', () => {
    const facts = extractProfileFacts(
      { Notes: ['Met at the conference, see https://www.linkedin.com/in/ada-quillfeather-7x2 for her CV'] },
      'Ada Quillfeather',
    );

    expect(facts.urls.size).toBe(0);
  });

  it('ignores SocialProfiles, avatar_url and website', () => {
    const facts = extractProfileFacts(
      {
        SocialProfiles: ['https://www.linkedin.com/in/ada-quillfeather-7x2'],
        avatar_url: 'https://www.linkedin.com/in/ada-quillfeather-7x2',
        website: 'https://www.linkedin.com/in/ada-quillfeather-7x2',
      },
      'Ada Quillfeather',
    );

    expect(facts.urls.size).toBe(0);
  });

  it('reads both records of a NOTE that merged two LinkedIn cards', () => {
    const facts = vcardPerson(
      'Ada Quillfeather',
      { url: 'https://www.linkedin.com/in/ada-quillfeather-7x2', connectedOn: '09 May 2014' },
      { url: 'https://www.linkedin.com/in/bo-quillfeather-3k9', connectedOn: '02 Jan 2019' },
    );

    expect([...facts.urls].sort()).toEqual([
      'linkedin.com/in/ada-quillfeather-7x2',
      'linkedin.com/in/bo-quillfeather-3k9',
    ]);
    expect([...facts.connectedOn].sort()).toEqual(['2014-05-09', '2019-01-02']);
  });

  it('reads URL lists and lower-case keys, and drops the non-LinkedIn entries', () => {
    const facts = extractProfileFacts(
      {
        URLs: ['https://quillfeather.example.com', 'https://www.linkedin.com/in/ada-quillfeather-7x2/'],
        url: ['https://www.linkedin.com/in/ada-quillfeather-7x2'],
        notes: 'URL: https://www.linkedin.com/company/quillfeather-labs',
      },
      'Ada Quillfeather',
    );

    expect([...facts.urls]).toEqual(['linkedin.com/in/ada-quillfeather-7x2']);
  });

  it('survives an empty or missing properties bag', () => {
    expect(extractProfileFacts(null, null).urls.size).toBe(0);
    expect(extractProfileFacts({}, 'Ada').urls.size).toBe(0);
  });
});

describe('adjudicateProfileUrls', () => {
  const ADA = 'https://www.linkedin.com/in/ada-quillfeather-7x2';
  const OTHER_ADA = 'https://www.linkedin.com/in/ada-quillfeather-9m4';
  const BO = 'https://www.linkedin.com/in/bo-quillfeather-3k9';

  it('is absent when either side states no URL', () => {
    expect(
      adjudicateProfileUrls(csvPerson('Ada Quillfeather', ADA), extractProfileFacts({}, 'Ada Quillfeather')),
    ).toEqual({
      kind: 'absent',
    });
  });

  it('grades the CSV and vCard copies of one connection exact', () => {
    const verdict = adjudicateProfileUrls(
      csvPerson('Ada Quillfeather', ADA, '09 May 2014'),
      vcardPerson('Ada Quillfeather', { url: `${ADA}/?trk=x`, connectedOn: '09 May 2014' }),
    );

    expect(verdict).toEqual({
      kind: 'exact',
      urls: ['linkedin.com/in/ada-quillfeather-7x2'],
      corroboratedBy: ['connected_on', 'name'],
    });
  });

  it('accepts a shared name token alone as corroboration', () => {
    const verdict = adjudicateProfileUrls(
      csvPerson('Ada Quillfeather', ADA),
      vcardPerson('Ada Q.', { url: ADA }),
    );

    expect(verdict).toMatchObject({ kind: 'exact', corroboratedBy: ['name'] });
  });

  it('accepts agreeing connection dates alone as corroboration', () => {
    const verdict = adjudicateProfileUrls(
      csvPerson('Ada Quillfeather', ADA, '09 May 2014'),
      vcardPerson('A. Q.', { url: ADA, connectedOn: '09 May 2014' }),
    );

    expect(verdict).toMatchObject({ kind: 'exact', corroboratedBy: ['connected_on'] });
  });

  it('holds an equal URL with conflicting surnames for review', () => {
    const verdict = adjudicateProfileUrls(
      csvPerson('Ada Quillfeather', ADA),
      vcardPerson('Ada Brightwater', { url: ADA }),
    );

    expect(verdict).toEqual({
      kind: 'review',
      urls: ['linkedin.com/in/ada-quillfeather-7x2'],
      reasons: ['family_name_conflict'],
    });
  });

  it('holds an equal URL with disagreeing connection dates for review', () => {
    const verdict = adjudicateProfileUrls(
      csvPerson('Ada Quillfeather', ADA, '09 May 2014'),
      vcardPerson('Ada Quillfeather', { url: ADA, connectedOn: '02 Jan 2019' }),
    );

    expect(verdict).toMatchObject({ kind: 'review', reasons: ['connected_on_conflict'] });
  });

  it('holds an equal URL with nothing corroborating it for review', () => {
    const verdict = adjudicateProfileUrls(
      csvPerson('Ada Quillfeather', ADA),
      vcardPerson('Zed', { url: ADA }),
    );

    expect(verdict).toMatchObject({ kind: 'review', reasons: ['uncorroborated'] });
  });

  it('does not count a shared initial as corroboration', () => {
    const verdict = adjudicateProfileUrls(csvPerson('A Quillfeather', ADA), vcardPerson('A Z', { url: ADA }));

    expect(verdict.kind).toBe('review');
  });

  it('calls overlapping but unequal sets partial', () => {
    const verdict = adjudicateProfileUrls(
      csvPerson('Ada Quillfeather', ADA),
      vcardPerson('Ada Quillfeather', { url: ADA }, { url: BO }),
    );

    expect(verdict).toEqual({
      kind: 'partial',
      shared: ['linkedin.com/in/ada-quillfeather-7x2'],
      left: ['linkedin.com/in/ada-quillfeather-7x2'],
      right: ['linkedin.com/in/ada-quillfeather-7x2', 'linkedin.com/in/bo-quillfeather-3k9'],
    });
  });

  it('calls disjoint sets a conflict, even with identical names and dates', () => {
    const verdict = adjudicateProfileUrls(
      csvPerson('Ada Quillfeather', ADA, '09 May 2014'),
      vcardPerson('Ada Quillfeather', { url: OTHER_ADA, connectedOn: '09 May 2014' }),
    );

    expect(verdict).toEqual({
      kind: 'conflict',
      left: ['linkedin.com/in/ada-quillfeather-7x2'],
      right: ['linkedin.com/in/ada-quillfeather-9m4'],
    });
  });

  it('gives the same verdict kind in either argument order', () => {
    const cases: Array<[ProfileFacts, ProfileFacts]> = [
      [csvPerson('Ada Quillfeather', ADA), vcardPerson('Ada Quillfeather', { url: ADA })],
      [csvPerson('Ada Quillfeather', ADA), vcardPerson('Ada Brightwater', { url: ADA })],
      [csvPerson('Ada Quillfeather', ADA), vcardPerson('Ada Quillfeather', { url: ADA }, { url: BO })],
      [csvPerson('Ada Quillfeather', ADA), vcardPerson('Ada Quillfeather', { url: OTHER_ADA })],
    ];

    for (const [left, right] of cases) {
      expect(adjudicateProfileUrls(right, left).kind).toBe(adjudicateProfileUrls(left, right).kind);
    }
  });
});

describe('applyProfileVerdict', () => {
  const ADA = csvPerson(
    'Ada Quillfeather',
    'https://www.linkedin.com/in/ada-quillfeather-7x2',
    '09 May 2014',
  );
  const ADA_VCARD = vcardPerson('Ada Quillfeather', {
    url: 'https://www.linkedin.com/in/ada-quillfeather-7x2',
    connectedOn: '09 May 2014',
  });
  const OTHER_ADA = vcardPerson('Ada Quillfeather', {
    url: 'https://www.linkedin.com/in/ada-quillfeather-9m4',
  });
  const TWO_CARDS = vcardPerson(
    'Ada Quillfeather',
    { url: 'https://www.linkedin.com/in/ada-quillfeather-7x2' },
    { url: 'https://www.linkedin.com/in/bo-quillfeather-3k9' },
  );

  const namePair = { score: 0.58, evidence: [{ kind: 'name_overlap', value: 'quillfeather', score: 0.58 }] };
  const emailPair = { score: 0.95, evidence: [{ kind: 'email', value: 'ada@example.com', score: 0.95 }] };

  it('lifts an exact pair to the auto-merge tier', () => {
    const result = applyProfileVerdict(namePair, adjudicateProfileUrls(ADA, ADA_VCARD));

    expect(result.score).toBe(PROFILE_URL_SCORES.exact);
    expect(result.evidence[0]).toEqual({
      kind: PROFILE_URL_EVIDENCE.match,
      value: 'linkedin.com/in/ada-quillfeather-7x2',
      score: PROFILE_URL_SCORES.exact,
    });
  });

  it('scores a contested equal URL at 0.8 and says why', () => {
    const result = applyProfileVerdict(
      { score: 0, evidence: [] },
      adjudicateProfileUrls(
        ADA,
        vcardPerson('Ada Brightwater', { url: 'linkedin.com/in/ada-quillfeather-7x2' }),
      ),
    );

    expect(result.score).toBe(PROFILE_URL_SCORES.contested);
    expect(result.evidence).toEqual([
      { kind: PROFILE_URL_EVIDENCE.match, value: 'linkedin.com/in/ada-quillfeather-7x2', score: 0.8 },
      { kind: PROFILE_URL_EVIDENCE.check, value: 'family_name_conflict', score: 0 },
    ]);
  });

  it('caps an email pair whose people state different profiles, and marks the conflict', () => {
    const result = applyProfileVerdict(emailPair, adjudicateProfileUrls(ADA, OTHER_ADA));

    expect(result.score).toBe(PROFILE_URL_SCORES.contested);
    expect(result.evidence.map((item) => item.kind)).toEqual(['email', PROFILE_URL_EVIDENCE.conflict]);
    expect(result.evidence[1].value).toBe(
      'linkedin.com/in/ada-quillfeather-7x2 ≠ linkedin.com/in/ada-quillfeather-9m4',
    );
  });

  it('never RAISES a pair because of a conflict', () => {
    const result = applyProfileVerdict(namePair, adjudicateProfileUrls(ADA, OTHER_ADA));

    expect(result.score).toBe(0.58);
    expect(result.evidence.map((item) => item.kind)).toEqual(['name_overlap', PROFILE_URL_EVIDENCE.conflict]);
  });

  it('caps a partial overlap at 0.8 even when an email joins it', () => {
    const result = applyProfileVerdict(emailPair, adjudicateProfileUrls(ADA, TWO_CARDS));

    expect(result.score).toBe(PROFILE_URL_SCORES.contested);
    expect(result.evidence.map((item) => item.kind)).toEqual(
      expect.arrayContaining([PROFILE_URL_EVIDENCE.match, PROFILE_URL_EVIDENCE.partial, 'email']),
    );
  });

  it('is idempotent', () => {
    for (const verdict of [
      adjudicateProfileUrls(ADA, ADA_VCARD),
      adjudicateProfileUrls(ADA, OTHER_ADA),
      adjudicateProfileUrls(ADA, TWO_CARDS),
    ]) {
      const once = applyProfileVerdict(emailPair, verdict);

      expect(applyProfileVerdict(once, verdict)).toEqual(once);
    }
  });

  it('replaces stale profile evidence instead of accumulating it', () => {
    const stale = applyProfileVerdict(namePair, adjudicateProfileUrls(ADA, ADA_VCARD));
    const fresh = applyProfileVerdict(stale, adjudicateProfileUrls(ADA, OTHER_ADA));

    expect(fresh.evidence.filter((item) => item.kind === PROFILE_URL_EVIDENCE.match)).toHaveLength(0);
    expect(fresh.score).toBe(0.58);
  });

  it('strips profile evidence when the verdict is absent', () => {
    const stale = applyProfileVerdict(namePair, adjudicateProfileUrls(ADA, ADA_VCARD));
    const fresh = applyProfileVerdict(stale, { kind: 'absent' });

    expect(fresh).toEqual(namePair);
  });
});

describe('the SQL prefilter', () => {
  const accepted = [
    'https://www.linkedin.com/in/ada-quillfeather-7x2',
    'HTTP://UK.LINKEDIN.COM/IN/ADA-QUILLFEATHER-7X2/',
    'linkedin.com/in/jos%C3%A9-quillfeather?trk=x',
    'https://www.LinkedIn.com/in/Ada-QuillFeather#top',
  ];

  it('is a superset of what the normaliser accepts', () => {
    // The prefilter narrows the load; the normaliser decides. A URL the
    // normaliser would accept but the prefilter would not load is a duplicate
    // missed silently — so every accepted URL must contain the token the
    // ILIKE tests for.
    for (const raw of accepted) {
      expect(normalizeProfileUrl(raw)).not.toBeNull();
      expect(raw.toLowerCase()).toContain(PROFILE_URL_PREFILTER_TOKEN);
    }
  });

  it('tests every field the extractor reads URLs from, case-insensitively', () => {
    expect(PROFILE_URL_SQL_PREFILTER).toMatch(/ILIKE '%linkedin%'$/);

    for (const key of ['URL', 'url', 'URLs', 'urls', 'Notes', 'notes']) {
      expect(PROFILE_URL_SQL_PREFILTER).toContain(`e.properties->>'${key}'`);
    }
  });

  it('loads exactly the keys the extractor reads', () => {
    const projection = profileFactsSqlObject('e');

    for (const key of PROFILE_FACT_PROPERTY_KEYS) {
      expect(projection).toContain(`'${key}', e.properties->'${key}'`);
    }

    expect(projection).not.toContain('SocialProfiles');
  });
});
