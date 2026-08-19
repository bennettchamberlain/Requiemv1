import path from 'node:path';

import { allDataSources } from '../registry';
import type { ImportParams, Timeframe } from '../timeline';

import '../google_my_activity';
import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'google_my_activity', 'My Activity');
const SEARCH_HTML = path.join(FIXTURES_DIR, 'Search', 'MyActivity.html');
const MAPS_HTML = path.join(FIXTURES_DIR, 'Maps', 'MyActivity.html');

function getImporter() {
  const ds = allDataSources().find((d) => d.name === 'google_my_activity');
  if (!ds?.newFileImporter) {
    throw new Error('missing importer');
  }

  return ds.newFileImporter();
}

async function runImport(fullPath: string, filename = 'MyActivity.html', timeframe: Timeframe = {}) {
  const importer = getImporter();
  const pipeline: EmittedGraph[] = [];
  await importer.fileImport({}, { filename, fullPath }, {
    pipeline,
    timeframe,
    log: () => {},
  } as unknown as ImportParams);

  return pipeline.filter((p) => p.item).map((p) => p.item);
}

describe('Google My Activity datasource', () => {
  it('recognizes a MyActivity.html file', async () => {
    const importer = getImporter();
    const rec = await importer.recognize({}, { filename: 'MyActivity.html', fullPath: SEARCH_HTML }, {});
    expect(rec.confidence).toBeGreaterThan(0.9);
  });

  it('recognizes a My Activity directory', async () => {
    const importer = getImporter();
    const rec = await importer.recognize({}, { filename: 'My Activity', fullPath: FIXTURES_DIR }, {});
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('does not recognize unrelated HTML', async () => {
    const importer = getImporter();
    const rec = await importer.recognize({}, { filename: 'index.html', fullPath: '/nope/index.html' }, {});
    expect(rec.confidence).toBe(0);
  });

  it('produces one item per activity entry', async () => {
    const items = await runImport(SEARCH_HTML);
    expect(items.length).toBe(2);
  });

  it('classifies "Visited" as page_view with URL + Title', async () => {
    const items = await runImport(SEARCH_HTML);
    const visited = items[0];
    expect(visited.classification).toBe('page_view');
    expect(visited.metadata?.Title).toBe("Jaron Lanier's Homepage");
    expect(visited.metadata?.URL).toContain('jaronlanier.com');
    expect(visited.metadata?.Product).toBe('Search');
  });

  it('classifies "Searched for" as search with Query as Text + Title', async () => {
    const items = await runImport(SEARCH_HTML);
    const searched = items[1];
    expect(searched.classification).toBe('search');
    expect(searched.metadata?.Title).toBe('Lanier');
    expect(searched.metadata?.Text).toBe('Lanier');
    expect(searched.metadata?.Query).toBe('Lanier');
  });

  it('classifies a link-less action entry as page_view with the action text as Title', async () => {
    const items = await runImport(MAPS_HTML);
    expect(items.length).toBe(1);
    expect(items[0].classification).toBe('page_view');
    expect(items[0].metadata?.Title).toBe('Explored on Google Maps');
    expect(items[0].metadata?.Product).toBe('Maps');
    expect(items[0].metadata?.URL).toBeUndefined();
  });

  it('sets a meaningful Title (never a bare filename)', async () => {
    const items = await runImport(SEARCH_HTML);
    expect(
      items.every((i) => {
        const t = i.metadata?.Title as string | undefined;

        return !!t && !t.toLowerCase().includes('myactivity');
      }),
    ).toBe(true);
  });

  it('parses real timestamps', async () => {
    const items = await runImport(SEARCH_HTML);
    expect(items[0].timestamp instanceof Date).toBe(true);
    // "Jun 17, 2026, 9:30:52 PM PDT" → UTC
    expect(items[0].timestamp?.toISOString()).toBe('2026-06-18T04:30:52.000Z');
    expect(items.every((i) => i.timestamp && !isNaN(i.timestamp!.getTime()))).toBe(true);
  });

  it('assigns a truthy, distinct, stable id to every item (idempotent re-import)', async () => {
    const first = await runImport(SEARCH_HTML);
    const ids = first.map((i) => i.id!);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const second = await runImport(SEARCH_HTML);
    expect(second.map((i) => i.id!)).toEqual(ids); // deterministic across runs
  });

  it('respects the timeframe filter', async () => {
    const items = await runImport(SEARCH_HTML, 'MyActivity.html', {
      since: new Date('2027-01-01T00:00:00Z'),
    });
    expect(items.length).toBe(0);
  });

  it('walks a directory and imports every product file', async () => {
    const items = await runImport(FIXTURES_DIR, 'My Activity');
    expect(items.length).toBe(3);
    const products = new Set(items.map((i) => i.metadata?.Product));
    expect(products.has('Search')).toBe(true);
    expect(products.has('Maps')).toBe(true);
  });
});
