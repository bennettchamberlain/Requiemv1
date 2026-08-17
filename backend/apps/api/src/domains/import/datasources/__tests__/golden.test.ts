/*
 * Golden-corpus snapshot tests.
 *
 * Format drift in a real export is the #1 source of silent data loss in this
 * repo (see the git log: Uber changed its layout, Takeout moved files, dedup
 * collapsed items …). Each fix was found by hand against a real export. This
 * harness turns that into an automatic guard: run every importer in the table
 * against its checked-in fixture and assert a stable summary of what it
 * produces (item counts, the classifications it emits, key-field coverage). If
 * a parser change or a fixture update drops records, these assertions fail in
 * CI instead of the loss reaching a user.
 *
 * Adding a source: drop a fixture under fixtures/<name>/ and add a row below.
 * The summary is intentionally coarse (counts, not exact payloads) so it's a
 * drift tripwire, not a brittle pin on every byte.
 */
import path from 'node:path';

import { allDataSources, type DirEntry } from '../registry';
import type { Graph, ImportParams } from '../timeline';

import '../index';
import type { EmittedGraph } from './support/emitted';

const FIXTURES = path.join(__dirname, 'fixtures');

interface GoldenCase {
  /** Registry name of the importer. */
  source: string;
  /** Fixture path relative to fixtures/ (a folder or a single file). */
  fixture: string;
  /** Floor on item count — a regression below this means dropped records. */
  minItems?: number;
  /** Floor on entity count — for sources that emit entities (e.g. contacts). */
  minEntities?: number;
  /** Classifications the importer must emit at least one of each. */
  classifications?: string[];
}

// Keep these conservative: a FLOOR, not the exact count, so legitimately adding
// to a fixture doesn't break the build — only a *drop* does. Exact counts are
// captured in the snapshot below for drift visibility.
const GOLDEN: GoldenCase[] = [
  { source: 'twitter', fixture: 'twitter-archive', minItems: 6, classifications: ['message', 'social'] },
  { source: 'chatgpt', fixture: 'chatgpt-export', minItems: 1, classifications: ['message', 'note'] },
  { source: 'claude', fixture: 'claude-export', minItems: 1, classifications: ['message', 'note'] },
  { source: 'gemini', fixture: 'gemini-takeout-memory', minItems: 1, classifications: ['message', 'note'] },
  { source: 'discord', fixture: 'discord-export', minItems: 1 },
  { source: 'reddit', fixture: 'reddit-export', minItems: 1 },
  { source: 'mastodon', fixture: 'mastodon-export', minItems: 1 },
  { source: 'google_keep', fixture: 'google-keep', minItems: 1 },
  { source: 'fitbit', fixture: 'fitbit-export', minItems: 1 },
  { source: 'geojson', fixture: 'sample.geojson', minItems: 1 },
  { source: 'calendar', fixture: 'sample.ics', minItems: 1, classifications: ['event'] },
  { source: 'vcard', fixture: 'sample.vcf', minEntities: 1 },
];

/** Walk a graph tree, visiting every node so nested edges count too. */
function walk(graph: Graph, visit: (g: Graph) => void): void {
  visit(graph);
  for (const edge of graph.edges ?? []) {
    walk(edge.to, visit);
  }
}

interface Summary {
  items: number;
  entities: number;
  relationships: number;
  byClassification: Record<string, number>;
  withTimestamp: number;
  withLocation: number;
}

async function runImporter(source: string, fixture: string): Promise<Summary> {
  const ds = allDataSources().find((d) => d.name === source);
  if (!ds?.newFileImporter) {
    throw new Error(`no file importer registered for '${source}'`);
  }

  const importer = ds.newFileImporter();

  const full = path.join(FIXTURES, fixture);
  const entry: DirEntry = { filename: path.basename(full), fsRoot: path.dirname(full), fullPath: full };

  const collected: Graph[] = [];
  const params = {
    options: ds.newOptions ? ds.newOptions() : {},
    pipeline: { push: (g: Graph) => collected.push(g as EmittedGraph) },
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams;

  await importer.fileImport({}, entry, params);

  const summary: Summary = {
    items: 0,
    entities: 0,
    relationships: 0,
    byClassification: {},
    withTimestamp: 0,
    withLocation: 0,
  };
  for (const root of collected) {
    walk(root, (g) => {
      if (g.item) {
        summary.items += 1;
        const c = g.item.classification ?? 'unclassified';
        summary.byClassification[c] = (summary.byClassification[c] ?? 0) + 1;
        if (g.item.timestamp) {
          summary.withTimestamp += 1;
        }

        if (g.item.location?.latitude != null) {
          summary.withLocation += 1;
        }
      }

      if (g.entity) {
        summary.entities += 1;
      }

      summary.relationships += g.edges?.length ?? 0;
    });
  }

  // Sort classification keys for a stable snapshot.
  summary.byClassification = Object.fromEntries(
    Object.entries(summary.byClassification).sort(([a], [b]) => a.localeCompare(b)),
  );

  return summary;
}

describe('golden corpus', () => {
  for (const c of GOLDEN) {
    it(`${c.source}: imports its fixture without dropping records`, async () => {
      const summary = await runImporter(c.source, c.fixture);

      // Floors on items/entities — the core "did we silently lose records?"
      // guard. Each case declares at least one.
      if (c.minItems) {
        expect(summary.items).toBeGreaterThanOrEqual(c.minItems);
      }

      if (c.minEntities) {
        expect(summary.entities).toBeGreaterThanOrEqual(c.minEntities);
      }

      // Required classifications, when declared.
      for (const cls of c.classifications ?? []) {
        // The classification rides along in the asserted value so a failure
        // names which one was missing — this loop is inside one test per source.
        expect({ cls, emitted: (summary.byClassification[cls] ?? 0) >= 1 }).toEqual({
          cls,
          emitted: true,
        });
      }

      // Exact-count drift tripwire: the committed snapshot pins the shape, so a
      // parser change that moves counts shows up as a reviewable diff.
      expect(summary).toMatchSnapshot();
    });
  }
});
