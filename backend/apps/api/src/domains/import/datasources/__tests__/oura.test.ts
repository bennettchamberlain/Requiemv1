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
