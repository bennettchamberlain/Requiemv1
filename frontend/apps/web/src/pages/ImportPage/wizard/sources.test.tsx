import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CatalogSource } from '../useImportApi';

import {
  BUNDLES,
  ECOSYSTEM_LABELS,
  PICKER_SECTIONS,
  SERVICE_LOGO,
  exportEntries,
  mergeObjects,
  objectsFor,
  pickableSections,
  shortTitle,
} from './sources';

/**
 * The wizard's presentation glue, held to what it promises:
 *
 *  - every logo the map names is a file that actually ships — a broken image
 *    on a service button is the most prominent way this page can look wrong;
 *  - the groupings are internally coherent, so a section can always label and
 *    glyph itself;
 *  - the pure derivations behind the picker and the export sequence do what
 *    their comments say (bundle collapses members, not-ready sorts last,
 *    unknown ecosystems still surface).
 */

const LOGO_DIR = path.resolve(__dirname, '../../../../public/import-logos');

function source(overrides: Partial<CatalogSource> & { id: string }): CatalogSource {
  return {
    title: overrides.id,
    blurb: '',
    ecosystem: 'misc',
    category: 'misc',
    acquisition: 'web-export',
    wait: 'minutes',
    steps: [],
    importer: overrides.id,
    importerReady: true,
    ...overrides,
  };
}

describe('SERVICE_LOGO', () => {
  it('names only files that ship in public/import-logos', () => {
    const missing = Object.entries(SERVICE_LOGO)
      .filter(([, file]) => !existsSync(path.join(LOGO_DIR, file)))
      .map(([id, file]) => `${id} → ${file}`);

    expect(missing).toEqual([]);
  });

  it('every bundle logo ships too', () => {
    for (const bundle of BUNDLES) {
      expect(existsSync(path.join(LOGO_DIR, bundle.logo))).toBe(true);
    }
  });
});

describe('the groupings', () => {
  it('every picker section can label its ecosystems', () => {
    for (const section of PICKER_SECTIONS) {
      for (const eco of section.ecosystems) {
        expect(ECOSYSTEM_LABELS[eco], `label for ${eco}`).toBeDefined();
      }
    }
  });

  it('no ecosystem appears in two sections', () => {
    const seen = new Set<string>();

    for (const section of PICKER_SECTIONS) {
      for (const eco of section.ecosystems) {
        expect(seen.has(eco), `${eco} claimed twice`).toBe(false);
        seen.add(eco);
      }
    }
  });
});

describe('shortTitle', () => {
  it('drops the parenthetical', () => {
    expect(shortTitle('Gmail (Google Takeout)')).toBe('Gmail');
    expect(shortTitle('Spotify')).toBe('Spotify');
  });
});

describe('pickableSections', () => {
  const catalog = [
    source({ id: 'gmail', title: 'Gmail (Google Takeout)', ecosystem: 'google' }),
    source({ id: 'google_photos', title: 'Google Photos', ecosystem: 'google' }),
    source({ id: 'spotify', title: 'Spotify', ecosystem: 'music' }),
    source({ id: 'deezer', title: 'Deezer', ecosystem: 'music', importerReady: false }),
    source({ id: 'whatsapp', title: 'WhatsApp', ecosystem: 'meta' }),
    source({ id: 'facebook', title: 'Facebook', ecosystem: 'meta' }),
  ];

  it('collapses bundle members into the bundle button', () => {
    const sections = pickableSections(catalog);
    const google = sections.find((section) => section.key === 'google');

    // gmail and google_photos are Takeout members: one bundle button, no
    // per-service buttons for them.
    expect(google?.items.map((item) => item.key)).toEqual(['b:google']);
  });

  it('keeps a service NOT covered by its ecosystem’s bundle as its own button', () => {
    const sections = pickableSections(catalog);
    const social = sections.find((section) => section.key === 'social');

    // WhatsApp exports separately from the Meta bundle.
    expect(social?.items.map((item) => item.key)).toEqual(['b:meta', 'whatsapp']);
  });

  it('sorts not-ready services last and marks them', () => {
    const sections = pickableSections(catalog);
    const music = sections.find((section) => section.key === 'music');

    expect(music?.items.map((item) => item.key)).toEqual(['spotify', 'deezer']);
    expect(music?.items[1].ready).toBe(false);
  });

  it('gives an ecosystem no section claims its own group', () => {
    const sections = pickableSections([
      source({ id: 'novel_service', title: 'Novel', ecosystem: 'brand-new-ecosystem' }),
    ]);

    expect(sections.map((section) => section.key)).toContain('brand-new-ecosystem');
  });
});

/**
 * The picker used to show a name and nothing else, so "what would adding this
 * give me" was answerable only by picking it and reading the next step. These
 * lists are derived from each source's authored `whatImported` rather than a
 * second field that would drift out of sync with it.
 */
describe('objectsFor', () => {
  it('reads the object nouns out of the authored sentences', () => {
    expect(
      objectsFor([
        'Every message with sender, recipients, subject, and date',
        'Thread relationships and inline + attached files',
      ]).map((object) => object.label),
    ).toEqual(['Messages', 'Files']);
  });

  it('orders by the vocabulary, not by how the sentences happened to be phrased', () => {
    const forwards = objectsFor(['Photos and videos with GPS']);
    const backwards = objectsFor(['GPS coordinates, videos and photos']);

    expect(forwards.map((object) => object.label)).toEqual(backwards.map((object) => object.label));
    expect(forwards.map((object) => object.label)).toEqual(['Photos', 'Videos', 'Places']);
  });

  it('claims nothing for a source with no authored list', () => {
    // An importer nobody has written yet must not have its output invented.
    expect(objectsFor(undefined)).toEqual([]);
    expect(objectsFor([])).toEqual([]);
  });

  it('caps a long list rather than growing the tile without limit', () => {
    expect(
      objectsFor([
        'Messages, photos, videos, calendar events, contacts, GPS',
        'Posts, listening history, watch history, bookmarks, orders',
      ]),
    ).toHaveLength(4);
  });

  it('gives a bundle the union of what its members import, deduplicated', () => {
    expect(
      mergeObjects([objectsFor(['Every message and photo']), objectsFor(['Photos and calendar events'])]).map(
        (object) => object.label,
      ),
    ).toEqual(['Messages', 'Photos', 'Calendar']);
  });
});

describe('exportEntries', () => {
  const catalog = [
    source({ id: 'gmail', ecosystem: 'google' }),
    source({ id: 'spotify', ecosystem: 'music' }),
    source({ id: 'facebook', ecosystem: 'meta' }),
    source({ id: 'whatsapp', ecosystem: 'meta' }),
  ];

  it('one card per pick: a bundle is one card, walked in picker order', () => {
    const entries = exportEntries(catalog, new Set(['b:google', 'spotify', 'whatsapp']));

    expect(entries.map((entry) => entry.key)).toEqual(['b:google', 'whatsapp', 'spotify']);
  });

  it('a bundle member picked THROUGH the bundle does not also get its own card', () => {
    const entries = exportEntries(catalog, new Set(['b:meta']));

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('bundle');
  });
});
