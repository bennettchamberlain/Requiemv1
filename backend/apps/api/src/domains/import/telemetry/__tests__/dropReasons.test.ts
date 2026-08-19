import fs from 'node:fs';
import path from 'node:path';

import {
  classifyDrops,
  dropReasonFor,
  dropSeverityFor,
  DROP_REASONS,
  DROP_SLUG_REASONS,
  gapsIn,
  totalDrops,
  UNCLASSIFIED,
  type DropReason,
} from '../dropReasons';

/**
 * The vocabulary is the part of this telemetry that agents depend on being
 * STABLE and CLOSED. A count grouped by a category that can silently gain a
 * 21st member, or a slug that maps to nothing, is not a vocabulary — it is
 * free prose with extra steps, which is what the drop ledger was before this.
 *
 * So three properties, all mechanical:
 *
 *  1. every registry entry maps into the declared category list;
 *  2. every category has a severity, because `gaps` is derived from it and a
 *     missing entry would silently make a real loss invisible;
 *  3. every drop slug the datasource pack actually emits is registered — the
 *     one that fails when somebody adds a parser and invents a 35th slug.
 */

describe('the drop reason vocabulary', () => {
  it('is closed: every registry entry maps into a declared reason', () => {
    const declared = new Set<string>(DROP_REASONS);

    for (const [slug, reason] of Object.entries(DROP_SLUG_REASONS)) {
      expect(declared.has(reason)).toBe(true);
      // Identifiers, not prose: they are grouped, counted and compared between
      // runs, and a space or a capital in one is a category nothing can group.
      // `collapsed-distinct-path` is the one hyphenated exception, kept as-is
      // because runs already in the database carry it.
      expect(slug).toMatch(/^[a-z0-9]+([_-][a-z0-9]+)*$/);
    }
  });

  it('gives every reason a severity, so a real loss cannot be silently expected', () => {
    for (const reason of DROP_REASONS) {
      expect(['expected', 'gap']).toContain(dropSeverityFor(reason));
    }
  });

  it('registers every drop slug the datasource parsers emit', () => {
    // Read off disk, the way stageKinds.test.ts reads the migrations: the point
    // is to fail when the PACK changes, which a hand-maintained list in this
    // file could never do.
    //
    // Literal call sites only. Two parsers compute the slug (amazon's
    // `dropReason(row)`, google_fit's `DropFn` wrapper) and those are exactly
    // why UNCLASSIFIED exists — but their literals are registered by hand, and
    // the assertion below proves the ones this scan CAN see are covered.
    const dir = path.join(__dirname, '../../datasources');
    const slugs = new Set<string>();

    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.ts')) {
        continue;
      }

      const body = fs.readFileSync(path.join(dir, name), 'utf8');

      for (const match of body.matchAll(/\bdrop\??\.?\(?\s*'([a-z0-9_]+)'/g)) {
        slugs.add(match[1]);
      }
    }

    // Guard against the regex quietly matching nothing after a refactor, which
    // would make this test pass while checking absolutely nothing.
    expect(slugs.size).toBeGreaterThan(25);

    const unregistered = [...slugs].filter((slug) => DROP_SLUG_REASONS[slug] == null).sort();

    expect(unregistered).toEqual([]);
  });

  it('buckets an unknown slug rather than losing it', () => {
    // The escape hatch has to be visible: a slug nobody registered must show up
    // in the telemetry as `unclassified`, so somebody notices and classifies
    // it. Guessing by prefix would quietly file `media_asset_missing` and
    // `missing_media` under different reasons forever.
    expect(dropReasonFor('a_brand_new_parser_slug')).toBe(UNCLASSIFIED);
    expect(dropSeverityFor(UNCLASSIFIED)).toBe('gap');
  });

  it('spells the four "the archive promised bytes it did not contain" slugs one way', () => {
    // The concrete motivation for a two-level vocabulary. Four parsers, four
    // spellings, one question: did this import lose media?
    for (const slug of [
      'media_asset_missing',
      'media_file_missing',
      'missing_media',
      'whatsapp_attachment_missing',
      'grok_attachment_missing',
    ]) {
      expect(dropReasonFor(slug)).toBe<DropReason>('media_missing');
    }
  });
});

describe('classifyDrops', () => {
  it('folds a real parser ledger into the closed vocabulary', () => {
    // The Lyft pass from the live QA corpus, verbatim: 0 items produced, and
    // the ledger is the only thing that says why.
    const drops = { cancelled_trip: 2, trip_without_start_time: 79 };

    expect(classifyDrops(drops)).toEqual({ cancelled: 2, no_timestamp: 79 });
    expect(totalDrops(drops)).toBe(81);
  });

  it('merges different slugs that mean the same thing', () => {
    expect(classifyDrops({ media_asset_missing: 3, missing_media: 4, media_file_missing: 5 })).toEqual({
      media_missing: 12,
    });
  });

  it('ignores zero and negative counts rather than minting empty categories', () => {
    expect(classifyDrops({ draft: 0, cancelled_order: 2 })).toEqual({ cancelled: 2 });
    expect(totalDrops({ draft: 0, cancelled_order: 2 })).toBe(2);
  });
});

describe('gapsIn', () => {
  it('reports only what somebody should look at, largest first', () => {
    // 40,000 filtered records are a working import; 12 ambiguous collapses are
    // twelve things nobody can name. Reporting one number for both is how the
    // second hid inside the first.
    const gaps = gapsIn({
      filtered: 40_000,
      already_present: 9_000,
      collapsed_ambiguous: 12,
      row_failed: 30,
    });

    expect(gaps).toEqual([
      { reason: 'row_failed', count: 30 },
      { reason: 'collapsed_ambiguous', count: 12 },
    ]);
  });

  it('is empty for a run whose every drop was expected', () => {
    expect(gapsIn({ filtered: 12, already_present: 5, duplicate_in_run: 900 })).toEqual([]);
  });
});
