import path from 'path';

import { AppleMusicFileImporter } from '../apple_music';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Apple Music datasource', () => {
  it('recognizes export directory by Play Activity CSV', async () => {
    const root = path.join(FIXTURES_DIR, 'apple_music-export');
    const fi = new AppleMusicFileImporter();
    const rec = await fi.recognize({}, { filename: 'apple_music-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('recognizes a single Play Activity CSV file directly', async () => {
    const fpath = path.join(FIXTURES_DIR, 'apple_music-export', 'Apple Music Play Activity.csv');
    const fi = new AppleMusicFileImporter();
    const rec = await fi.recognize({}, { filename: 'Apple Music Play Activity.csv', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('recognizes a renamed CSV by its header columns', async () => {
    const fs = await import('node:fs');
    const tmpFile = path.join(FIXTURES_DIR, 'apple_music-export', 'export_renamed.csv');
    const src = path.join(FIXTURES_DIR, 'apple_music-export', 'Apple Music Play Activity.csv');
    await fs.promises.copyFile(src, tmpFile);
    try {
      const fi = new AppleMusicFileImporter();
      const rec = await fi.recognize({}, { filename: 'export_renamed.csv', fullPath: tmpFile });
      expect(rec.confidence).toBeGreaterThan(0.8);
    } finally {
      await fs.promises.unlink(tmpFile).catch(() => {});
    }
  });

  it('imports play activity into play items', async () => {
    const root = path.join(FIXTURES_DIR, 'apple_music-export');
    const fi = new AppleMusicFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'apple_music-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    expect(pipeline.length).toBe(3);

    const first = pipeline[0].item;
    expect(first.classification).toBe('listen');
    expect(first.metadata.Track).toBe('Karma Police');
    expect(first.metadata.Artist).toBe('Radiohead');
    expect(first.metadata.Album).toBe('OK Computer');
    expect(first.metadata['ms Played']).toBe(265000);
    expect(typeof first.metadata['ms Played']).toBe('number');
    expect(first.metadata['End Reason']).toBe('NATURAL_END_OF_TRACK');
    expect(first.timestamp).toBeInstanceOf(Date);
    expect(first.timestamp!.toISOString()).toBe('2023-01-15T10:30:00.000Z');

    // Album with an embedded comma must survive the CSV parser intact.
    expect(pipeline[1].item.metadata.Album).toBe('OK Computer, Deluxe Edition');
  });

  it('respects the timeframe filter', async () => {
    const root = path.join(FIXTURES_DIR, 'apple_music-export');
    const fi = new AppleMusicFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'apple_music-export', fullPath: root }, {
      pipeline,
      timeframe: { since: new Date('2023-02-01T00:00:00Z') },
      log: () => {},
    } as unknown as ImportParams);

    expect(pipeline.length).toBe(1);
    expect(pipeline[0].item.metadata.Track).toBe('Bohemian Rhapsody');
  });

  it('does not throw on an empty or malformed CSV file', async () => {
    const fs = await import('node:fs');
    const fi = new AppleMusicFileImporter();

    const emptyFile = path.join(FIXTURES_DIR, 'apple_music-export', 'empty.csv');
    await fs.promises.writeFile(emptyFile, '');
    const pipeline: EmittedGraph[] = [];
    try {
      await fi.fileImport({}, { filename: 'empty.csv', fullPath: emptyFile }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);
      expect(pipeline.length).toBe(0);
      const rec = await fi.recognize({}, { filename: 'empty.csv', fullPath: emptyFile });
      expect(rec.confidence).toBe(0);
    } finally {
      await fs.promises.unlink(emptyFile).catch(() => {});
    }
  });
});
