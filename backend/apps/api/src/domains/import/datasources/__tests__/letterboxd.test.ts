import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

import { LetterboxdFileImporter } from '../letterboxd';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

// diary.csv export with rows that share the SAME 'Watched Date'. Before the id
// fix these collapsed to a single dedup key: sha1(data_source \0 'watch' \0
// 'watch.txt' \0 '' \0 ISO(midnight-of-day) \0 ''). Each row carries a distinct
// 'Letterboxd URI'.
const HEADER = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date';
const ROWS = [
  '2024-03-01,Dune,2021,https://boxd.it/aaa,5,No,,2024-03-01',
  '2024-03-01,Arrival,2016,https://boxd.it/bbb,4,No,,2024-03-01',
  '2024-03-01,Sicario,2015,https://boxd.it/ccc,4,No,,2024-03-01',
];

function writeExport(): string {
  const tmp = path.join(os.tmpdir(), `diary-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  fs.writeFileSync(tmp, `${HEADER}\n${ROWS.join('\n')}\n`);

  return tmp;
}

async function importRows(fpath: string): Promise<EmittedGraph[]> {
  const fi = new LetterboxdFileImporter();
  const pipeline: EmittedGraph[] = [];
  await fi.fileImport({}, { filename: path.basename(fpath), fullPath: fpath }, {
    pipeline,
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams);

  return pipeline;
}

describe('Letterboxd datasource', () => {
  it('does not recognize a same-named CSV from a different app', async () => {
    // "diary.csv" and "ratings.csv" are generic names other apps' own exports
    // use verbatim (a mood-tracking app's diary, a beer-rating app's ratings)
    // — the filename tier used to skip the header check entirely and return
    // 0.8 the moment the name matched, outranking other importers' own
    // content-verified tiers.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-letterboxd-lookalike-'));
    const fpath = path.join(dir, 'diary.csv');
    fs.writeFileSync(fpath, 'Date,Mood,Notes\n2024-03-01,Good,Slept well\n');

    const fi = new LetterboxdFileImporter();
    const rec = await fi.recognize({}, { filename: 'diary.csv', fullPath: fpath });
    expect(rec.confidence).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('assigns a unique stable id to every film even when Watched Date collides', async () => {
    const fpath = writeExport();
    try {
      const pipeline = await importRows(fpath);
      expect(pipeline.length).toBe(ROWS.length);

      const ids = pipeline.map((p) => p.item.id!);
      // (a) every id truthy
      expect(ids.every((id) => !!id)).toBe(true);
      // (b) no collisions despite identical day-precision timestamp + constant filename
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
      expect(first).toEqual(['https://boxd.it/aaa', 'https://boxd.it/bbb', 'https://boxd.it/ccc']);
    } finally {
      await fs.promises.unlink(fpath).catch(() => {});
    }
  });
});
