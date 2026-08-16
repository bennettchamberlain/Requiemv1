import path from 'path';

import { MyfitnesspalFileImporter } from '../myfitnesspal';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('MyFitnessPal datasource', () => {
  it('recognizes export directory by Nutrition-Summary csv', async () => {
    const root = path.join(FIXTURES_DIR, 'myfitnesspal-export');
    const fi = new MyfitnesspalFileImporter();
    const rec = await fi.recognize({}, { filename: 'myfitnesspal-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('recognizes a single Nutrition-Summary csv directly', async () => {
    const fpath = path.join(
      FIXTURES_DIR,
      'myfitnesspal-export',
      'Nutrition-Summary-2023-01-15-to-2023-01-16.csv',
    );
    const fi = new MyfitnesspalFileImporter();
    const rec = await fi.recognize({}, { filename: path.basename(fpath), fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it("returns zero confidence for another importer's csv directory", async () => {
    // netflix-export contains a ViewingActivity.csv whose header has none of the
    // nutrition columns — must not false-match.
    const root = path.join(FIXTURES_DIR, 'netflix-export');
    const fi = new MyfitnesspalFileImporter();
    const rec = await fi.recognize({}, { filename: 'netflix-export', fullPath: root });
    expect(rec.confidence).toBe(0);
  });

  it('imports nutrition rows as observation items', async () => {
    const root = path.join(FIXTURES_DIR, 'myfitnesspal-export');
    const fi = new MyfitnesspalFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'myfitnesspal-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    expect(pipeline.length).toBe(5);

    const first = pipeline[0].item;
    expect(first.classification).toBe('observation');
    expect(first.timestamp).toBeInstanceOf(Date);
    expect(first.timestamp!.getTime()).toBe(new Date('2023-01-15').getTime());
    expect(first.metadata.Meal).toBe('Breakfast');
    expect(first.metadata.Calories).toBe(420);
    expect(first.metadata['Protein (g)']).toBe(22);
    expect(first.metadata['Carbohydrates (g)']).toBe(48);
    expect(first.metadata['Fat (g)']).toBe(14);
    expect(first.metadata.Source).toBe('MyFitnessPal');
    // title-bearing key so titleFor no longer falls back to basename('nutrition.txt')
    expect(first.metadata.Title).toBe('2023-01-15 Breakfast — 420 kcal');
    expect(first.metadata.Title).not.toBe(first.content.filename);
  });

  it('assigns a distinct stable id per (date, meal) so same-day meals do not collapse', async () => {
    // The fixture logs Breakfast/Lunch/Dinner all on 2023-01-15 with the same
    // bare-date (midnight UTC) timestamp; without an explicit id they collapse
    // to one dedup hash.
    const root = path.join(FIXTURES_DIR, 'myfitnesspal-export');
    const fi = new MyfitnesspalFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'myfitnesspal-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const ids = pipeline.map((g) => g.item.id!);
    // (a) every id is truthy
    expect(ids.every(Boolean)).toBe(true);
    // (b) all ids are unique
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(5);

    // (c) re-import yields identical ids (idempotent)
    const pipeline2: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'myfitnesspal-export', fullPath: root }, {
      pipeline: pipeline2,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    expect(pipeline2.map((g) => g.item.id!)).toEqual(ids);
  });

  it('handles quoted fields with embedded commas via the CSV parser', async () => {
    const root = path.join(FIXTURES_DIR, 'myfitnesspal-export');
    const fi = new MyfitnesspalFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'myfitnesspal-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const snackRow = pipeline.find((g) => g.item.metadata.Meal === 'Snacks, afternoon');
    expect(snackRow).toBeDefined();
    expect(snackRow!.item.metadata.Calories).toBe(180);
  });

  it('filters rows outside the timeframe', async () => {
    const root = path.join(FIXTURES_DIR, 'myfitnesspal-export');
    const fi = new MyfitnesspalFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'myfitnesspal-export', fullPath: root }, {
      pipeline,
      timeframe: { since: new Date('2023-01-15T12:00:00Z') },
      log: () => {},
    } as unknown as ImportParams);

    // Only the 2023-01-16 rows survive (strictly after the since boundary).
    expect(pipeline.length).toBe(2);
    for (const g of pipeline) {
      expect(g.item.timestamp!.getTime()).toBe(new Date('2023-01-16').getTime());
    }
  });

  it('does not throw on an empty file', async () => {
    const fs = await import('node:fs');
    const tmpFile = path.join(FIXTURES_DIR, 'myfitnesspal-export', 'empty-tmp.csv');
    await fs.promises.writeFile(tmpFile, '');
    const fi = new MyfitnesspalFileImporter();
    const pipeline: EmittedGraph[] = [];
    try {
      const rec = await fi.recognize({}, { filename: 'empty-tmp.csv', fullPath: tmpFile });
      expect(rec.confidence).toBe(0);
      await fi.fileImport({}, { filename: 'empty-tmp.csv', fullPath: tmpFile }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);
      expect(pipeline.length).toBe(0);
    } finally {
      await fs.promises.unlink(tmpFile).catch(() => {});
    }
  });
});
