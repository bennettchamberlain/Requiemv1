import fs from 'node:fs';
import path from 'node:path';

import { PrimeVideoFileImporter } from '../prime_video';
import type { ImportParams } from '../timeline';

import type { EmittedGraph, TestPipeline } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// The real file double-quotes its cells; the fixture reproduces that (a quoted
// CSV field whose content itself begins and ends with a quote character).
const HEADER =
  '"Playback Start Datetime (UTC)","Playback End Datetime (UTC)","Title","Seconds Viewed",' +
  '"Material Type Description","Device Manufacturer Name","Device Model","Amazon Device Model Name",' +
  '"Operating System Name","Browser","City","State","Country Code","Content Quality Delivered","Audio Language Code"';

const row = (
  start: string,
  end: string,
  title: string,
  secs: string,
  material: string,
  extra: Partial<Record<'city' | 'device', string>> = {},
): string =>
  [
    `"${start}"`,
    `"${end}"`,
    `"""${title}"""`,
    `"${secs}"`,
    `"""${material}"""`,
    '"""Not available"""',
    '"""Not available"""',
    `"""${extra.device ?? 'Not available'}"""`,
    '"""Android"""',
    '"""Not available"""',
    `"""${extra.city ?? 'Irvine'}"""`,
    '"""CA"""',
    '"""US"""',
    '"""HD"""',
    '"""en-US"""',
  ].join(',');

const importCsv = async (name: string, csv: string) => {
  const tmp = path.join(FIXTURES_DIR, `${name}.PrimeVideo.ViewingHistory.csv`);
  await fs.promises.writeFile(tmp, csv);
  try {
    const pipeline: EmittedGraph[] = [];
    const drops: Array<[string, string | undefined]> = [];
    (pipeline as TestPipeline).drop = (reason: string, detail?: string) => drops.push([reason, detail]);
    await new PrimeVideoFileImporter().fileImport({}, { filename: path.basename(tmp), fullPath: tmp }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    return { items: pipeline.map((g) => g.item), drops };
  } finally {
    await fs.promises.unlink(tmp).catch(() => {});
  }
};

describe('Prime Video datasource', () => {
  it('recognizes the file by name and by header, and rejects unrelated CSVs', async () => {
    const fi = new PrimeVideoFileImporter();
    const named = path.join(FIXTURES_DIR, '__rec__.PrimeVideo.ViewingHistory.csv');
    const renamed = path.join(FIXTURES_DIR, '__rec__.export.csv');
    const unrelated = path.join(FIXTURES_DIR, '__rec__.other.csv');
    await fs.promises.writeFile(named, HEADER + '\n');
    await fs.promises.writeFile(renamed, HEADER + '\n');
    await fs.promises.writeFile(unrelated, '"Start Time","Title","Profile Name"\n'); // netflix-shaped
    try {
      expect(
        (await fi.recognize({}, { filename: path.basename(named), fullPath: named })).confidence,
      ).toBeGreaterThan(0.9);
      expect(
        (await fi.recognize({}, { filename: path.basename(renamed), fullPath: renamed })).confidence,
      ).toBeGreaterThan(0.8);
      expect(
        (await fi.recognize({}, { filename: path.basename(unrelated), fullPath: unrelated })).confidence,
      ).toBe(0);
    } finally {
      for (const f of [named, renamed, unrelated]) {
        await fs.promises.unlink(f).catch(() => {});
      }
    }
  });

  it('imports one watch per session; repeat views share a URI but not an id', async () => {
    const csv = [
      HEADER,
      row(
        '2026-06-27T05:02:29Z',
        '2026-06-27T05:26:16Z',
        "De Rolo's Eleven-The Legend of Vox Machina - Season 4",
        '1426.86100',
        'Feature',
      ),
      row(
        '2026-06-28T04:10:00Z',
        '2026-06-28T04:33:00Z',
        "De Rolo's Eleven-The Legend of Vox Machina - Season 4",
        '1380.00000',
        'Feature',
      ),
      row('2020-01-05T20:00:00Z', '2020-01-05T21:40:00Z', 'Knives Out', '6000.5', 'Feature'),
    ].join('\n');
    const { items } = await importCsv('__sessions__', csv);
    expect(items.length).toBe(3);

    // Every session is its own item with a distinct, content-derived id…
    expect(new Set(items.map((i) => i.id!)).size).toBe(3);
    // …but both sittings of the episode carry the SAME URI, which is what the
    // content lane keys on — one content row, two events.
    const [a, b, movie] = items;
    expect(a.metadata.URI).toBe(b.metadata.URI);
    expect(movie.metadata.URI).not.toBe(a.metadata.URI);

    expect(a.classification).toBe('watch');
    // The video's type — streams are assumed mp4 — not the text stub's.
    expect(a.content.mediaType).toBe('video/mp4');
    expect(a.timestamp?.toISOString()).toBe('2026-06-27T05:02:29.000Z');
    expect(a.timespanEnd?.toISOString()).toBe('2026-06-27T05:26:16.000Z');
    // Quote-wrapping stripped everywhere; seconds rounded to integers.
    expect(a.metadata.Title).toBe("De Rolo's Eleven-The Legend of Vox Machina - Season 4");
    expect(a.metadata['Seconds Viewed']).toBe(1427);
    expect(a.metadata.City).toBe('Irvine');
    expect(a.metadata.State).toBe('CA');
  });

  it('drops promos and trailers to the ledger but keeps untyped material', async () => {
    const csv = [
      HEADER,
      row('2026-06-27T05:02:26Z', '2026-06-27T05:02:27Z', 'Some Show Promo', '1.2', 'Promo'),
      row('2026-06-27T05:03:00Z', '2026-06-27T05:03:02Z', 'Some Movie Trailer', '2.0', 'Trailer'),
      // Pre-2015 clients reported no material type; those are real viewings.
      row('2013-03-01T02:00:00Z', '2013-03-01T02:20:00Z', 'Old Show Episode', '1200', 'Not available'),
      row('2024-05-05T01:00:00Z', '2024-05-05T01:45:00Z', 'A Real Feature', '2700', 'Full'),
    ].join('\n');
    const { items, drops } = await importCsv('__promos__', csv);
    expect(items.map((i) => i.metadata.Title)).toEqual(['Old Show Episode', 'A Real Feature']);
    expect(drops).toEqual([
      ['promo_playback', 'Some Show Promo'],
      ['promo_playback', 'Some Movie Trailer'],
    ]);
    // The untyped row carries no Material claim at all.
    expect(items[0].metadata.Material).toBeUndefined();
  });

  // Zero seconds viewed alone is ambiguous: it also marks UNMETERED real
  // watching (Live broadcasts run for hours with the meter stuck at 0). Only a
  // zero whose wall clock was also over in under a minute is an abandoned start.
  it('drops zero-second sub-minute sessions but keeps unmetered long ones', async () => {
    const csv = [
      HEADER,
      // 5-second wall clock, 0 viewed → abandoned start.
      row(
        '2026-01-11T05:04:34Z',
        '2026-01-11T05:04:39Z',
        'The Demon in the Snow-Fallout - Season 2',
        '0',
        'Full',
      ),
      // 2-hour wall clock, 0 viewed → unmetered Live watching; keep.
      row('2026-03-14T02:58:00Z', '2026-03-14T04:58:00Z', 'Main Broadcast', '0', 'Live'),
      // 0 viewed but NO end datetime → span unknowable; keep.
      row('2026-02-01T01:00:00Z', 'Not available', 'Endless Mystery', '0', 'Full'),
      // Sub-minute wall clock with real seconds viewed → keep (short but watched).
      row('2026-04-01T01:00:00Z', '2026-04-01T01:00:45Z', 'Quick Peek', '40', 'Full'),
    ].join('\n');
    const { items, drops } = await importCsv('__abandoned__', csv);
    expect(items.map((i) => i.metadata.Title)).toEqual(['Main Broadcast', 'Endless Mystery', 'Quick Peek']);
    expect(drops).toEqual([['abandoned_playback', 'The Demon in the Snow-Fallout - Season 2']]);
  });

  it('gives exactly-duplicate sessions distinct stable ids', async () => {
    const dup = row('2024-05-05T01:00:00Z', '2024-05-05T01:45:00Z', 'A Real Feature', '2700', 'Full');
    const { items } = await importCsv('__dups__', [HEADER, dup, dup].join('\n'));
    expect(items.length).toBe(2);
    expect(new Set(items.map((i) => i.id!)).size).toBe(2);
    // Re-import yields the same ids (idempotent).
    const again = await importCsv('__dups__', [HEADER, dup, dup].join('\n'));
    expect(again.items.map((i) => i.id!)).toEqual(items.map((i) => i.id!));
  });

  it('respects the timeframe filter and omits Not-available fields', async () => {
    const csv = [
      HEADER,
      row('2013-03-01T02:00:00Z', '2013-03-01T02:20:00Z', 'Old Show Episode', '1200', 'Not available'),
      row('2024-05-05T01:00:00Z', '2024-05-05T01:45:00Z', 'A Real Feature', '2700', 'Full', {
        device: 'Fire TV Stick 4K',
        city: 'Not available',
      }),
    ].join('\n');
    const pipelineAll = await importCsv('__frame_all__', csv);
    expect(pipelineAll.items.length).toBe(2);

    const tmp = path.join(FIXTURES_DIR, '__frame__.PrimeVideo.ViewingHistory.csv');
    await fs.promises.writeFile(tmp, csv);
    try {
      const pipeline: EmittedGraph[] = [];
      await new PrimeVideoFileImporter().fileImport({}, { filename: path.basename(tmp), fullPath: tmp }, {
        pipeline,
        timeframe: { since: new Date('2020-01-01T00:00:00Z') },
        log: () => {},
      } as unknown as ImportParams);
      expect(pipeline.length).toBe(1);
      const it = pipeline[0].item;
      expect(it.metadata.Title).toBe('A Real Feature');
      expect(it.metadata.Device).toBe('Fire TV Stick 4K');
      expect(it.metadata.City).toBeUndefined(); // "Not available" is no value
    } finally {
      await fs.promises.unlink(tmp).catch(() => {});
    }
  });
});
