import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

import { GoodreadsFileImporter } from '../goodreads';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

// CSV header for a Goodreads library export, plus rows that share the SAME
// 'Date Added' and no 'Date Read'. Before the id fix these collapsed to a
// single dedup key: sha1(data_source \0 classification \0 'book.txt' \0 ''
// \0 ISO(midnight-of-day) \0 ''). Each row carries a distinct 'Book Id'.
const HEADER =
  'Book Id,Title,Author,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,My Review,Exclusive Shelf,Date Read,Date Added,ISBN,ISBN13,Bookshelves';
const ROWS = [
  '1001,Dune,Frank Herbert,5,4.25,Ace,Paperback,412,1965,,read,,2024/03/01,="0441013597",="9780441013593",sci-fi',
  '1002,Neuromancer,William Gibson,4,3.89,Ace,Paperback,271,1984,,read,,2024/03/01,="0441569595",="9780441569595",sci-fi',
  '1003,Foundation,Isaac Asimov,5,4.16,Spectra,Paperback,244,1951,,read,,2024/03/01,="0553293354",="9780553293357",sci-fi',
];

function writeExport(): string {
  const tmp = path.join(
    os.tmpdir(),
    `goodreads_library_export-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`,
  );
  fs.writeFileSync(tmp, `${HEADER}\n${ROWS.join('\n')}\n`);

  return tmp;
}

async function importRows(fpath: string): Promise<EmittedGraph[]> {
  const fi = new GoodreadsFileImporter();
  const pipeline: EmittedGraph[] = [];
  await fi.fileImport({}, { filename: path.basename(fpath), fullPath: fpath }, {
    pipeline,
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams);

  return pipeline;
}

describe('Goodreads datasource', () => {
  it('assigns a unique stable id to every book even when Date Added collides', async () => {
    const fpath = writeExport();
    try {
      const pipeline = await importRows(fpath);
      expect(pipeline.length).toBe(ROWS.length);

      const ids = pipeline.map((p) => p.item.id!);
      // (a) every id truthy
      expect(ids.every((id) => !!id)).toBe(true);
      // (b) no collisions despite identical timestamp + constant filename
      expect(new Set(ids).size).toBe(pipeline.length);
    } finally {
      await fs.promises.unlink(fpath).catch(() => {});
    }
  });

  it('produces identical ids on re-import (idempotent)', async () => {
    const fpath = writeExport();
    try {
      const first = (await importRows(fpath)).map((p) => p.item.id!);
      const second = (await importRows(fpath)).map((p) => p.item.id!);
      expect(second).toEqual(first);
      expect(first).toEqual(['goodreads:1001', 'goodreads:1002', 'goodreads:1003']);
    } finally {
      await fs.promises.unlink(fpath).catch(() => {});
    }
  });

  it("classifies a shelved book without a review as 'annotation'", async () => {
    const fpath = writeExport();
    try {
      const pipeline = await importRows(fpath);
      // Every ROW has an empty 'My Review' (shelved, not reviewed); these used
      // to fall through to the unmapped 'interaction' classification.
      expect(pipeline.every((p) => p.item.classification === 'annotation')).toBe(true);
    } finally {
      await fs.promises.unlink(fpath).catch(() => {});
    }
  });
});
