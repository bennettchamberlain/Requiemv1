import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

import { GoogleLocationFileImporter } from '../google_location';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

// Write a throwaway Location History dir with the given location records.
function tmpRecords(locations: unknown[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-gloc-'));
  fs.writeFileSync(path.join(dir, 'Records.json'), JSON.stringify({ locations }));

  return dir;
}

async function importRecords(locations: unknown[]) {
  const dir = tmpRecords(locations);
  const fi = new GoogleLocationFileImporter();
  const pipeline: EmittedGraph[] = [];
  await fi.fileImport({}, { filename: path.basename(dir), fullPath: dir }, {
    pipeline,
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams);

  return pipeline.filter((p) => p.item);
}

describe('Google Location History (Legacy) MVP', () => {
  it('recognizes directory with Records.json', async () => {
    const dir = path.join(FIXTURES_DIR, 'google-location-legacy');
    const fi = new GoogleLocationFileImporter();
    const rec = await fi.recognize({}, { filename: path.basename(dir), fullPath: dir });
    expect(rec.confidence).toBeGreaterThan(0.7);
  });
  it('imports single location', async () => {
    const dir = path.join(FIXTURES_DIR, 'google-location-legacy');
    const fi = new GoogleLocationFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: path.basename(dir), fullPath: dir }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    const items = pipeline.filter((p) => p.item);
    expect(items.length).toBe(1);
    expect(items[0].item.location!.latitude).toBeCloseTo(37.4221234, 6);
  });

  it('parses an ISO-8601 string timestamp (newer legacy format)', async () => {
    const items = await importRecords([
      { latitudeE7: 374221234, longitudeE7: -1220839876, timestamp: '2024-11-02T00:26:40Z' },
    ]);
    expect(items.length).toBe(1);
    expect(items[0].item.timestamp instanceof Date).toBe(true);
    expect(items[0].item.timestamp!.toISOString()).toBe('2024-11-02T00:26:40.000Z');
  });

  it('skips a record missing one coordinate axis (no null-island fallback)', async () => {
    const items = await importRecords([
      { latitudeE7: 374221234, timestampMs: '1730500000000' }, // no longitude
    ]);
    expect(items.length).toBe(0);
  });

  it('skips a (0,0) null-island record', async () => {
    const items = await importRecords([{ latitudeE7: 0, longitudeE7: 0, timestampMs: '1730500000000' }]);
    expect(items.length).toBe(0);
  });

  it('titles each fix from its coordinates, not the bare filename', async () => {
    const items = await importRecords([
      { latitudeE7: 374221234, longitudeE7: -1220839876, timestamp: '2024-11-02T00:26:40Z' },
    ]);
    expect(items.length).toBe(1);
    expect(items[0].item.metadata.Title).toBe('Location 37.42212, -122.08399');
    expect(items[0].item.metadata.Title).not.toBe('location.txt');
  });

  it('keeps duplicate timestamp+coord stationary samples distinct (no dedup collapse)', async () => {
    // Two bit-identical fixes (same timestamp, same lat/lon) would collapse to one
    // row on the dedup hash without a stable per-record id.
    const dup = { latitudeE7: 374221234, longitudeE7: -1220839876, timestamp: '2024-11-02T00:26:40Z' };
    const items = await importRecords([dup, dup]);
    expect(items.length).toBe(2);
    const ids = items.map((p) => p.item.id!);
    expect(ids.every((id) => !!id)).toBe(true); // every id truthy
    expect(new Set(ids).size).toBe(items.length); // all ids unique

    // Re-importing the same export yields identical ids (idempotent).
    const again = await importRecords([dup, dup]);
    expect(again.map((p) => p.item.id!)).toEqual(ids);
  });
});
