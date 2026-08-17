import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { MicrosoftAccountFileImporter } from '../microsoft_account';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';
import { metaText } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const MS_DIR = path.join(FIXTURES_DIR, 'microsoft-account-export');
const MS_FULL_DIR = path.join(FIXTURES_DIR, 'microsoft-privacy-export-json');
const MS_CSV_DIR = path.join(FIXTURES_DIR, 'microsoft-privacy-export-csv');

function tmpFile(content: string, name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-msft-'));
  const p = path.join(dir, name);
  fs.writeFileSync(p, content);

  return p;
}

async function run(fullPath: string) {
  const fi = new MicrosoftAccountFileImporter();
  const pipeline: EmittedGraph[] = [];
  await fi.fileImport({}, { filename: path.basename(fullPath), fullPath }, {
    pipeline,
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams);

  return pipeline;
}

describe('Microsoft account datasource', () => {
  it('recognizes a directory with the anchor files', async () => {
    const fi = new MicrosoftAccountFileImporter();
    const rec = await fi.recognize({}, { filename: 'microsoft-account-export', fullPath: MS_DIR });
    expect(rec.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('recognizes a single anchor file', async () => {
    const fi = new MicrosoftAccountFileImporter();
    const f = path.join(MS_DIR, 'ProductAndServiceUsage.json');
    const rec = await fi.recognize({}, { filename: 'ProductAndServiceUsage.json', fullPath: f });
    expect(rec.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it('does not recognize an arbitrary json file', async () => {
    const p = tmpFile('[{"a":1}]', 'something.json');
    const fi = new MicrosoftAccountFileImporter();
    const rec = await fi.recognize({}, { filename: 'something.json', fullPath: p });
    expect(rec.confidence).toBe(0);
  });

  it('imports records from both wrapped and array files', async () => {
    // ProductAndServiceUsage in MS_DIR is anchor-only (not imported), so only
    // the 2 ContentConsumption rows come through.
    const pipeline = await run(MS_DIR);
    expect(pipeline.length).toBe(2);
    expect(pipeline.every((p) => p.item.metadata.Source === 'Microsoft')).toBe(true);
    expect(pipeline.every((p) => p.item.classification === 'note')).toBe(true);

    // The { pages: [...] } wrapper unwraps for non-skipped files too.
    const wrapped = tmpFile(
      JSON.stringify({ pages: [{ DateTime: '2024-01-05T10:00:00Z', Title: 'A Page' }] }),
      'LocationHistory.json',
    );
    const items = await run(wrapped);
    expect(items.length).toBe(1);
    expect(items[0].item.classification).toBe('location');
  });

  it('parses both ISO and /Date(ms)/ timestamps', async () => {
    const pipeline = await run(MS_DIR);
    expect(pipeline.every((p) => p.item.timestamp instanceof Date)).toBe(true);
  });

  it('malformed input does not throw', async () => {
    const p = tmpFile('{ not json,,,\x00', 'ContentConsumption.json');
    await expect(run(p)).resolves.toBeDefined();
  });

  it('empty input yields no items', async () => {
    const p = tmpFile('', 'ContentConsumption.json');
    const pipeline = await run(p);
    expect(pipeline.length).toBe(0);
  });

  it('classifies by filename kind rather than hard-coding social', async () => {
    const rows = [{ DateTime: '2024-03-01T08:15:00Z', Url: 'https://example.com' }];
    const browse = await run(tmpFile(JSON.stringify(rows), 'Browse.json'));
    expect(browse.length).toBe(1);
    expect(browse[0].item.classification).toBe('page_view');

    const search = await run(tmpFile(JSON.stringify(rows), 'SearchRequestsAndQuery.json'));
    expect(search.length).toBe(1);
    expect(search[0].item.classification).toBe('search');
  });

  it('synthesizes a title-bearing key instead of the bare filename', async () => {
    const pipeline = await run(MS_DIR);
    // Every row carries a Title metadata key (titleFor reads it before the
    // filename fallback), and none is the bare 'microsoft.txt'.
    expect(
      pipeline.every(
        (p) => typeof p.item.metadata.Title === 'string' && metaText(p.item.metadata.Title).length > 0,
      ),
    ).toBe(true);
    expect(pipeline.some((p) => p.item.metadata.Title === 'microsoft.txt')).toBe(false);
    // Title uses the best available column (Title/AppName), prefixed by Kind.
    const titles = pipeline.map((p) => p.item.metadata.Title);
    expect(titles).toContain('ContentConsumption — A Documentary');
  });

  it('falls back to the category Kind when no title column exists', async () => {
    const rows = [{ SearchTime: '2024-03-01T08:15:00Z', Engine: 'Bing' }];
    const search = await run(tmpFile(JSON.stringify(rows), 'SearchRequestsAndQuery.json'));
    expect(search.length).toBe(1);
    expect(search[0].item.metadata.Title).toBe('SearchRequestsAndQuery');
  });

  it('imports every category of a full JSON-era archive with per-category classification', async () => {
    // Fixture mirrors all archive categories (see fixtures/microsoft-privacy-export-README.md
    // for per-file verification status): search, browse, location, voice, app usage, media.
    const fi = new MicrosoftAccountFileImporter();
    const rec = await fi.recognize({}, { filename: 'microsoft-privacy-export-json', fullPath: MS_FULL_DIR });
    expect(rec.confidence).toBeGreaterThanOrEqual(0.8);

    const pipeline = await run(MS_FULL_DIR);
    // 3 media + 4 search + 3 browse + 3 location + 2 voice (usage is skipped)
    expect(pipeline.length).toBe(15);

    const byClass = (c: string) => pipeline.filter((p) => p.item.classification === c);
    expect(byClass('page_view').length).toBe(3); // BrowseHistory.json
    expect(byClass('location').length).toBe(3); // LocationActivity.json
    expect(byClass('search').length).toBe(4); // SearchRequestsAndQuery.json
    expect(byClass('note').length).toBe(5); // media, voice

    expect(pipeline.every((p) => p.item.timestamp instanceof Date)).toBe(true);
    // JSON-era numeric coordinates also become positions.
    const locs = pipeline.filter((p) => p.item.classification === 'location');
    expect(locs.every((p) => typeof p.item.location?.latitude === 'number')).toBe(true);
    const titles = pipeline.map((p) => p.item.metadata.Title);
    expect(titles).toContain('SearchRequestsAndQuery — weather redmond wa');
    expect(titles).toContain('Weather - Bing'); // browse entries: bare page title, no Kind prefix
    expect(titles).toContain('ContentConsumption — A Totally Fictional Documentary');
    expect(pipeline.some((p) => p.item.metadata.Kind === 'ProductAndServiceUsage')).toBe(false);
  });

  it('recognizes and imports a CSV-era archive (2022+ format)', async () => {
    // Headers for SearchRequestsAndQuery.csv / ProductAndServiceUsage.csv are
    // verified against a real 2026 export; see fixtures/microsoft-privacy-export-README.md.
    const fi = new MicrosoftAccountFileImporter();
    const rec = await fi.recognize({}, { filename: 'microsoft-privacy-export-csv', fullPath: MS_CSV_DIR });
    expect(rec.confidence).toBeGreaterThanOrEqual(0.8);

    const single = await fi.recognize(
      {},
      {
        filename: 'SearchRequestsAndQuery.csv',
        fullPath: path.join(MS_CSV_DIR, 'SearchRequestsAndQuery.csv'),
      },
    );
    expect(single.confidence).toBeGreaterThanOrEqual(0.8);

    const pipeline = await run(MS_CSV_DIR);
    // 5 search + 4 browse + 3 location (ProductAndServiceUsage.csv is skipped)
    expect(pipeline.length).toBe(12);
    const byClass = (c: string) => pipeline.filter((p) => p.item.classification === c);
    expect(byClass('page_view').length).toBe(4); // BrowsingHistory.csv
    expect(byClass('location').length).toBe(3); // LocationActivity.csv
    expect(byClass('search').length).toBe(5); // SearchRequestsAndQuery.csv

    // Quoted "MM/DD/YYYY HH:mm:ss +00:00" timestamps parse to the right instant.
    expect(pipeline.every((p) => p.item.timestamp instanceof Date)).toBe(true);
    const search = pipeline.find((p) => p.item.metadata.SearchTerms === 'weather redmond wa');
    expect(search!.item.timestamp!.toISOString()).toBe('2024-01-15T08:05:12.000Z');

    const titles = pipeline.map((p) => p.item.metadata.Title);
    expect(titles).toContain('SearchRequestsAndQuery — weather redmond wa');
    expect(titles).toContain('Weather - Bing'); // browse entries: bare page title, no Kind prefix
    expect(pipeline.some((p) => p.item.metadata.Kind === 'ProductAndServiceUsage')).toBe(false);

    // Location columns become real positions (item.location), not just metadata…
    expect(search!.item.metadata.Latitude).toBe('47.641944');
    expect(search!.item.location).toEqual({ latitude: 47.641944, longitude: -122.127222 });
    const locations = pipeline.filter((p) => p.item.classification === 'location');
    expect(
      locations.every(
        (p) =>
          typeof p.item.location?.latitude === 'number' && typeof p.item.location?.longitude === 'number',
      ),
    ).toBe(true);
    // …and rows without coordinates get no location.
    const noCoords = pipeline.find((p) => p.item.metadata.Title === 'Contoso Home');
    expect(noCoords!.item.location).toBeUndefined();
    // …and empty union-header cells are dropped, not imported as '' metadata
    // (search-only rows have no clicked-result Url/Title/Time).
    expect(search!.item.metadata).not.toHaveProperty('Url');
    expect(search!.item.metadata).not.toHaveProperty('DeviceId');
  });

  it('supports the alternate Edge-style BrowsingHistory schema', async () => {
    // Second candidate schema seen in the wild: DateTime,PageTitle,NavigatedUrl,
    // DeviceType,Source,Latitude,Longitude,Accuracy (ISO 8601 timestamps).
    const csv = [
      'DateTime,PageTitle,NavigatedUrl,DeviceType,Source,Latitude,Longitude,Accuracy',
      '2024-01-15T08:07:02Z,Weather - Bing,https://www.bing.com/weather,PC,EdgeBrowser,47.641944,-122.127222,65',
      '2024-01-16T19:22:10Z,Contoso Home,https://www.contoso.example/,Mobile,EdgeMobile,,,',
    ].join('\n');
    const pipeline = await run(tmpFile(csv, 'BrowsingHistory.csv'));
    expect(pipeline.length).toBe(2);
    expect(pipeline.every((p) => p.item.classification === 'page_view')).toBe(true);
    expect(pipeline[0].item.timestamp!.toISOString()).toBe('2024-01-15T08:07:02.000Z');

    // Bare page title, URL normalized onto the Url key browser_activity reads,
    // client id preserved without clobbering the reserved Source stamp.
    expect(pipeline[0].item.metadata.Title).toBe('Weather - Bing');
    expect(pipeline[0].item.metadata.Url).toBe('https://www.bing.com/weather');
    expect(pipeline[0].item.metadata.ClientSource).toBe('EdgeBrowser');
    expect(pipeline[0].item.metadata.Source).toBe('Microsoft');

    // Coordinates become a position; the coordinate-less row gets none.
    expect(pipeline[0].item.location).toEqual({ latitude: 47.641944, longitude: -122.127222 });
    expect(pipeline[1].item.location).toBeUndefined();
  });

  it('does not collapse records with missing or identical timestamps', async () => {
    // Three rows: two with no date-like field (ts undefined) and two sharing
    // the same second. Pre-fix these would hash identically and collapse.
    const rows = [
      { Query: 'cats', Engine: 'Bing' },
      { Query: 'dogs', Engine: 'Bing' },
      { SearchTime: '2024-03-01T08:15:00Z', Query: 'birds' },
      { SearchTime: '2024-03-01T08:15:00Z', Query: 'fish' },
    ];
    const p = tmpFile(JSON.stringify(rows), 'SearchRequestsAndQuery.json');
    const pipeline = await run(p);
    expect(pipeline.length).toBe(4);
    const ids = pipeline.map((g) => g.item.id!);
    expect(ids.every((id) => !!id)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    // Re-import is idempotent: identical ids.
    const again = await run(p);
    expect(again.map((g) => g.item.id!)).toEqual(ids);
  });
});
