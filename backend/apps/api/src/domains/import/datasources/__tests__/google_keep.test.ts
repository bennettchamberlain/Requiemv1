import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

import { GoogleKeepFileImporter } from '../google_keep';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';
import { metaText } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const KEEP_DIR = path.join(FIXTURES_DIR, 'google-keep');
const ANNOTATION_ONLY_DIR = path.join(FIXTURES_DIR, 'google-keep-annotation-only');

describe('Google Keep datasource', () => {
  it('recognizes a Keep export directory (Labels.txt + note JSONs)', async () => {
    const fi = new GoogleKeepFileImporter();
    const rec = await fi.recognize({}, { filename: 'google-keep', fullPath: KEEP_DIR });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('recognizes a single Keep note JSON directly', async () => {
    const fpath = path.join(KEEP_DIR, '2023-01-15T10_30_00.000-08_00.json');
    const fi = new GoogleKeepFileImporter();
    const rec = await fi.recognize({}, { filename: path.basename(fpath), fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('does not recognize an unrelated directory', async () => {
    const fi = new GoogleKeepFileImporter();
    const rec = await fi.recognize(
      {},
      { filename: 'netflix-export', fullPath: path.join(FIXTURES_DIR, 'netflix-export') },
    );
    expect(rec.confidence).toBe(0);
  });

  it('imports each non-trashed note as a note item with correct fields', async () => {
    const fi = new GoogleKeepFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-keep', fullPath: KEEP_DIR }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    // Three JSONs in the dir but one is trashed -> two items.
    expect(pipeline.length).toBe(2);
    const items = pipeline.map((p) => p.item);

    // All are 'note'.
    expect(items.every((i) => i.classification === 'note')).toBe(true);
    // None is trashed (the deleted note is gone).
    expect(items.some((i) => i.metadata.Title === 'Deleted note')).toBe(false);

    const errands = items.find((i) => i.metadata.Title === 'Weekend errands');
    expect(errands).toBeDefined();
    expect(errands!.metadata.Source).toBe('Google Keep');
    expect(errands!.metadata.Labels).toEqual(['Personal', 'Errands']);
    expect(errands!.metadata.Pinned).toBe(true);
    expect(errands!.metadata.Color).toBe('BLUE');
    expect(errands!.metadata.Archived).toBe(false);
    expect(errands!.timestamp).toBeInstanceOf(Date);
    expect(errands!.timestamp!.toISOString()).toBe('2023-01-15T20:30:00.000Z');
    const errandsBody = (await errands!.content.data!()).toString('utf8');
    expect(errandsBody).toContain('Pick up dry cleaning');

    // The list-only note: no title -> Title falls back to first line of the
    // joined checklist (NOT the bare filename).
    const list = items.find((i) => i.metadata.Title !== 'Weekend errands');
    expect(list).toBeDefined();
    expect(list!.metadata.Title).not.toMatch(/\.json$/);
    expect(list!.metadata.Title).toBe('[x] Milk');
    expect(list!.metadata.Archived).toBe(true);
    expect(list!.metadata.Pinned).toBeUndefined(); // not pinned -> omitted
    expect(list!.metadata.Color).toBeUndefined(); // DEFAULT -> omitted
    expect(list!.timestamp!.toISOString()).toBe('2023-02-10T22:30:00.000Z');
    const listBody = (await list!.content.data!()).toString('utf8');
    expect(listBody).toContain('[ ] Eggs');
    expect(listBody).toContain('[ ] Bread');
  });

  it('produces a Title for every item (never a bare filename) and valid timestamps', async () => {
    const fi = new GoogleKeepFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-keep', fullPath: KEEP_DIR }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    for (const { item } of pipeline) {
      expect(typeof item.metadata.Title).toBe('string');
      expect(metaText(item.metadata.Title).length).toBeGreaterThan(0);
      expect(item.metadata.Title).not.toMatch(/\.json$/);
      expect(item.timestamp).toBeInstanceOf(Date);
      expect(isNaN(item.timestamp!.getTime())).toBe(false);
    }
  });

  it('assigns stable, distinct ids and is idempotent on re-import', async () => {
    const fi = new GoogleKeepFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-keep', fullPath: KEEP_DIR }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const ids = pipeline.map((p) => p.item.id!);
    expect(ids.every(Boolean)).toBe(true); // every id truthy
    expect(new Set(ids).size).toBe(ids.length); // all distinct
    expect(ids.every((id) => id!.startsWith('keep:'))).toBe(true);

    const pipeline2: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-keep', fullPath: KEEP_DIR }, {
      pipeline: pipeline2,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    expect(pipeline2.map((p) => p.item.id!)).toEqual(ids); // idempotent
  });

  it('respects the timeframe filter', async () => {
    const fi = new GoogleKeepFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-keep', fullPath: KEEP_DIR }, {
      pipeline,
      timeframe: { since: new Date('2023-02-01T00:00:00Z') },
      log: () => {},
    } as unknown as ImportParams);
    // Only the February list note survives.
    expect(pipeline.length).toBe(1);
    expect(pipeline[0].item.timestamp!.toISOString()).toBe('2023-02-10T22:30:00.000Z');
  });

  // Regression test: a note whose real content lives entirely in an
  // annotation (e.g. a shared-place/WEBLINK chip) — empty title, no
  // textContent/listContent at all — must not import as a contentless
  // "Keep note" placeholder. This fixture deliberately has NO textContent so
  // the textContent path can't mask a broken annotations path (unlike the
  // shared google-keep/2023-01-15... fixture, which has both).
  it('falls back to annotation content when a note has no textContent/listContent', async () => {
    const fi = new GoogleKeepFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'google-keep-annotation-only', fullPath: ANNOTATION_ONLY_DIR }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    expect(pipeline.length).toBe(1);
    const item = pipeline[0].item;

    // Title must NOT be the generic empty-note placeholder — it should be
    // derived from the annotation's own title.
    expect(item.metadata.Title).toBe('Blue Bottle Coffee');
    expect(item.metadata.Title).not.toBe('Keep note');

    // Body metadata (and the imported file content) must actually contain
    // the annotation's description and url, not be missing/empty.
    expect(item.metadata.Body).toBeDefined();
    expect(item.metadata.Body).toContain('Blue Bottle Coffee');
    expect(item.metadata.Body).toContain('300 Webster St, Oakland, CA');
    expect(item.metadata.Body).toContain('https://maps.google.com/?cid=1234567890');

    const content = (await item.content!.data!()).toString('utf8');
    expect(content).toContain('Blue Bottle Coffee');
    expect(content).toContain('300 Webster St, Oakland, CA');
  });

  it('does not throw on an empty file and yields zero items', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-empty-'));
    const fpath = path.join(dir, 'empty.json');
    fs.writeFileSync(fpath, '');
    try {
      const fi = new GoogleKeepFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'empty.json', fullPath: fpath }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);
      expect(pipeline.length).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
