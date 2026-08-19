import path from 'path';

import { OuraFileImporter } from '../oura';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Oura datasource', () => {
  it('recognizes export directory by trends CSV header', async () => {
    const root = path.join(FIXTURES_DIR, 'oura-export');
    const fi = new OuraFileImporter();
    const rec = await fi.recognize({}, { filename: 'oura-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('recognizes a single trends CSV file directly', async () => {
    const fpath = path.join(FIXTURES_DIR, 'oura-export', 'oura_trends.csv');
    const fi = new OuraFileImporter();
    const rec = await fi.recognize({}, { filename: 'oura_trends.csv', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('does not recognize an empty/non-matching directory', async () => {
    const fi = new OuraFileImporter();
    // netflix-export exists but its header is not an Oura header.
    const root = path.join(FIXTURES_DIR, 'netflix-export');
    const rec = await fi.recognize({}, { filename: 'netflix-export', fullPath: root });
    expect(rec.confidence).toBe(0);
  });

  it('imports trends rows into observation items with correct timestamp & metadata', async () => {
    const root = path.join(FIXTURES_DIR, 'oura-export');
    const fi = new OuraFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'oura-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    expect(pipeline.length).toBe(3);

    const first = pipeline[0].item;
    expect(first.classification).toBe('observation');
    expect(first.timestamp).toBeInstanceOf(Date);
    expect(first.timestamp!.toISOString()).toBe('2024-01-15T00:00:00.000Z');
    // Numeric metric columns become numbers.
    expect(first.metadata['Sleep Score']).toBe(82);
    expect(first.metadata['Readiness Score']).toBe(78);
    expect(first.metadata['Activity Score']).toBe(90);
    expect(first.metadata['Average HRV']).toBe(45);
    expect(first.metadata['Respiratory Rate']).toBe(15.6);
    expect(first.metadata['Body Temperature']).toBe(-0.2);
    expect(first.metadata.Source).toBe('Oura');
    // Title-bearing Summary so titleFor doesn't fall back to the bare 'observation.txt' filename.
    expect(first.metadata.Summary).toBe('Oura 2024-01-15 — Sleep 82 / Readiness 78 / Activity 90');
    expect(first.metadata.Summary).not.toBe(first.content.filename);
    // Date column is not duplicated into metadata.
    expect(first.metadata.date).toBeUndefined();

    // Empty metric cells are omitted from metadata.
    const third = pipeline[2].item;
    expect(third.metadata['Sleep Score']).toBe(88);
    expect('Activity Score' in third.metadata).toBe(false);
    // Missing metric still yields a distinct, title-bearing Summary.
    expect(third.metadata.Summary).toBe('Oura 2024-01-17 — Sleep 88 / Readiness 85 / Activity ?');
  });

  it('filters rows by timeframe', async () => {
    const root = path.join(FIXTURES_DIR, 'oura-export');
    const fi = new OuraFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'oura-export', fullPath: root }, {
      pipeline,
      timeframe: { since: new Date('2024-01-15T12:00:00Z') },
      log: () => {},
    } as unknown as ImportParams);

    // Only 2024-01-16 and 2024-01-17 are strictly after the since bound.
    expect(pipeline.length).toBe(2);
    expect(pipeline[0].item.timestamp!.toISOString()).toBe('2024-01-16T00:00:00.000Z');
  });

  // Regression: one row is emitted per calendar day with a constant
  // 'observation.txt' filename, so hashItem's id-less fallback hashes only
  // (data_source, classification, filename, timestamp) — two rows sharing a
  // Date (an overlapping re-export date range, or a malformed export with a
  // duplicate date) would otherwise silently collapse into one row on
  // INSERT OR IGNORE.
  it('assigns unique, stable ids to rows that would otherwise dedup-collapse on a shared date', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const tmp = path.join(os.tmpdir(), `oura-collapse-${Date.now()}.csv`);
    await fs.promises.writeFile(
      tmp,
      'date,Sleep Score,Readiness Score,Activity Score\n' +
        '2024-02-01,80,75,88\n' +
        '2024-02-01,81,76,89\n' + // duplicate date within the same file
        '2024-02-02,79,74,85\n',
    );
    const fi = new OuraFileImporter();
    try {
      const run = async () => {
        const pipeline: EmittedGraph[] = [];
        await fi.fileImport({}, { filename: 'oura-collapse.csv', fullPath: tmp }, {
          pipeline,
          timeframe: {},
          log: () => {},
        } as unknown as ImportParams);

        return pipeline;
      };

      const items = await run();
      expect(items.length).toBe(3);
      const ids = items.map((p) => p.item.id!);
      // (a) every row gets an id
      expect(ids.every(Boolean)).toBe(true);
      // (b) all ids are unique despite the first two rows sharing a date,
      // classification, and the constant 'observation.txt' filename.
      expect(new Set(ids).size).toBe(items.length);

      // (c) re-import yields identical ids (idempotent).
      const again = await run();
      expect(again.map((p) => p.item.id!)).toEqual(ids);
    } finally {
      await fs.promises.unlink(tmp).catch(() => {});
    }
  });

  it('does not throw on an empty CSV file', async () => {
    const fi = new OuraFileImporter();
    const fs = await import('node:fs');
    const os = await import('node:os');
    const tmp = path.join(os.tmpdir(), `oura-empty-${Date.now()}.csv`);
    await fs.promises.writeFile(tmp, '');
    try {
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'oura-empty.csv', fullPath: tmp }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);
      expect(pipeline.length).toBe(0);
    } finally {
      await fs.promises.unlink(tmp).catch(() => {});
    }
  });
});
