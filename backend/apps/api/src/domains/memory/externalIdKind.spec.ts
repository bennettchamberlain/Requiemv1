import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  classifyExternalId,
  EXTERNAL_ID_URI_SHAPE,
  EXTERNAL_ID_UUID_SHAPE,
  SOURCE_NATIVE_EXTERNAL_ID_KIND,
} from './externalIdKind';

/**
 * Every scheme-prefixed `external_id` an in-tree datasource can mint today, as
 * of the F22 audit. Each one was stamped `'file'` by migration
 * 20260818215331's `source_system IS DISTINCT FROM 'spotify'` rule — the
 * mislabel this predicate exists to make impossible.
 */
const SOURCE_NATIVE_URIS = [
  // domains/import/datasources/spotify.ts (the only one the old rule knew about)
  'spotify:track:4uLU6hMCjMI75M1A2tKUQC',
  'spotify:episode:512ojhOuo1ktJprKbVcKyQ',
  'spotify:show:5CfCWKI5pZ28U0uOzXkDHe',
  // domains/import/datasources/amazon_music.ts
  'amazonmusic:track:B07JQZ1KMP',
  'amazonmusic:album:B08XYZ1234',
  // domains/import/datasources/audible.ts
  'audible:asin:B002V0QK4C',
  // domains/import/datasources/kindle_reading.ts
  'kindle:asin:B00X4WHP55',
  'kindle:doc:B00X4WHP55',
  // domains/import/datasources/prime_video.ts
  'primevideo:title:9f2c1b0a4d3e5f60',
];

describe('classifyExternalId', () => {
  it.each(SOURCE_NATIVE_URIS)('classifies the scheme-prefixed id %s as external_uri', (uri) => {
    expect(classifyExternalId(uri)).toBe('external_uri');
  });

  it('classifies a URL as external_uri — any scheme counts, not a hard-coded list', () => {
    expect(classifyExternalId('https://cdn.example.com/photo.jpg')).toBe('external_uri');
    expect(classifyExternalId('http://example.com/a')).toBe('external_uri');
    // A scheme this codebase has never seen must classify the same way: the
    // whole point is that the rule survives the next datasource.
    expect(classifyExternalId('someunreleasedsource:thing:42')).toBe('external_uri');
  });

  it('classifies a uuid as a file id, case-insensitively', () => {
    expect(classifyExternalId('0198f0a1-2b3c-7d4e-8f90-1a2b3c4d5e6f')).toBe('file');
    expect(classifyExternalId('0198F0A1-2B3C-7D4E-8F90-1A2B3C4D5E6F')).toBe('file');
  });

  it('anchors the uuid shape at both ends — a uuid-with-a-tail is not a file id', () => {
    expect(classifyExternalId('0198f0a1-2b3c-7d4e-8f90-1a2b3c4d5e6f-extra')).toBeUndefined();
    expect(classifyExternalId('urn:0198f0a1-2b3c-7d4e-8f90-1a2b3c4d5e6f')).toBe('external_uri');
    expect(classifyExternalId('0198f0a1-2b3c-7d4e-8f90-1a2b3c4d5e')).toBeUndefined();
  });

  it('leaves a bare platform id UNCLASSIFIED rather than guessing file', () => {
    // These are the ETL connectors' external_ids. Guessing 'file' for them is
    // exactly the defect; the transforms stamp them explicitly instead.
    for (const bare of [
      'dQw4w9WgXcQ', // YouTube videoId
      'UCuAXFkgsw1L7xaCfnd5JJOw', // YouTube channelId
      '1a2B3cDeFgHiJkLmNoPqRsTuV', // Google Drive fileId
      '01ABCDEFGHIJKLMNOPQRSTUVWXYZ', // OneDrive itemId
      '730', // Steam appid
      '10160123456789012', // Facebook post id
      '3n3Ppam7vgaVa1iaRUc9Lp', // bare Spotify track id (ETL, not the URI form)
    ]) {
      expect(classifyExternalId(bare)).toBeUndefined();
    }
  });

  it('requires a lowercase-alpha scheme — a digit or uppercase before the colon is not a scheme', () => {
    // GitHub's commit-comment external_id is `<sha>:<id>`; a hex sha almost
    // always contains digits, so it must NOT read as a scheme prefix.
    expect(classifyExternalId('7d3a19b0f2:8891234')).toBeUndefined();
    expect(classifyExternalId('Spotify:track:x')).toBeUndefined();
    expect(classifyExternalId(':leading')).toBeUndefined();
  });

  it('treats absent/empty input as unclassified', () => {
    expect(classifyExternalId(undefined)).toBeUndefined();
    expect(classifyExternalId(null)).toBeUndefined();
    expect(classifyExternalId('')).toBeUndefined();
  });

  it('never lets both shapes match the same value (the two kinds are disjoint)', () => {
    const values = [
      ...SOURCE_NATIVE_URIS,
      '0198f0a1-2b3c-7d4e-8f90-1a2b3c4d5e6f',
      'https://example.com',
      'dQw4w9WgXcQ',
      '730',
    ];

    for (const value of values) {
      expect(EXTERNAL_ID_URI_SHAPE.test(value) && EXTERNAL_ID_UUID_SHAPE.test(value)).toBe(false);
    }
  });

  it('names external_uri as the kind an ETL connector stamps', () => {
    // The const exists so the transforms document WHY once; if it ever became
    // 'file' every connector row would start claiming to be a ci.files id.
    expect(SOURCE_NATIVE_EXTERNAL_ID_KIND).toBe('external_uri');
  });
});

/**
 * The SQL backfill and this predicate are one rule with two implementations.
 * The first version of this column drifted the moment a fifth URI source
 * landed; this test fails loudly if the SQL stops mirroring the TypeScript.
 */
describe('migration 20260818235804 mirrors the predicate', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../../db/postgres/migrations/20260818235804_fix_content_external_id_kind_by_shape.sql',
    ),
    'utf8',
  );

  it('uses the same two patterns the TypeScript classifier uses', () => {
    // Postgres `~` takes the pattern as a string literal, so the TS regex source
    // appears verbatim inside single quotes.
    expect(sql).toContain(`'${EXTERNAL_ID_URI_SHAPE.source}'`);
    expect(sql).toContain(`'${EXTERNAL_ID_UUID_SHAPE.source}'`);
  });

  it('guards the additive statements on external_id_kind IS NULL', () => {
    // Two of the three UPDATEs must only stamp what is unstamped; the third is
    // the deliberate repair of the mislabel and is scoped to 'file' rows whose
    // value is scheme-prefixed.
    // Statements only — the header quotes 20260818215331's UPDATEs verbatim to
    // explain the defect, and those lines are comments (leading `--`).
    const updates = sql.match(/^UPDATE ci\.content[\s\S]*?;/gm) ?? [];
    expect(updates).toHaveLength(3);

    const [repair, ...additive] = updates;
    expect(repair).toContain("WHERE external_id_kind = 'file'");
    expect(repair).toContain(`AND external_id ~ '${EXTERNAL_ID_URI_SHAPE.source}'`);

    for (const statement of additive) {
      expect(statement).toContain('WHERE external_id_kind IS NULL');
    }
  });
});
