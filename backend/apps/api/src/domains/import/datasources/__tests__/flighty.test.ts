import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

import { allDataSources } from '../registry';
import type { DirEntry } from '../registry';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

import '../flighty';

function getImporter(name: string) {
  const ds = allDataSources().find((d) => d.name === name);
  if (!ds || !ds.newFileImporter) {
    throw new Error('missing importer');
  }

  return ds.newFileImporter();
}

describe('flighty importer', () => {
  it('recognizes flighty csv and imports items', async () => {
    const importer = getImporter('flighty');
    const tmp = await fs.promises.mkdtemp(path.join(tmpdir(), 'flighty-'));
    const fpath = path.join(tmp, 'FlightyExport-2024-09-01.csv');
    const headers = [
      'Flight Flighty ID',
      'Airline',
      'Flight',
      'From',
      'To',
      'Take off (Actual)',
      'Landing (Actual)',
      'Notes',
    ];
    const row = [
      'abc123',
      'MyAir',
      'MX100',
      'AAA',
      'BBB',
      '2024-09-01T10:00',
      '2024-09-01T12:00',
      'Great flight',
    ];
    await fs.promises.writeFile(fpath, headers.join(',') + '\n' + row.join(','));
    const rec = await importer.recognize({}, { filename: fpath } as DirEntry, {});
    expect(rec.confidence).toBe(1);
    const pipeline: EmittedGraph[] = [];
    await importer.fileImport({}, { filename: fpath } as DirEntry, { pipeline } as unknown as ImportParams);
    expect(pipeline.length).toBeGreaterThanOrEqual(1);
    expect(pipeline[0].item.metadata['Flight number']).toBe('MX100');
    // Title-bearing key so titleFor() resolves a meaningful title, not 'flight-abc123.md'
    expect(pipeline[0].item.metadata.Title).toBe('MX100 AAA→BBB (MyAir)');
    expect(pipeline[0].item.metadata.Title).not.toBe(
      path.basename(String(pipeline[0].item.content.filename)),
    );
    const notesItem = pipeline.find((p) => p.item.metadata.Notes);
    expect(notesItem!.item.metadata.Title).toBe('Notes — MX100 AAA→BBB');

    // The notes item is a distinct row keyed off the same flight id, not a
    // second copy of the flight item's own content.
    expect(String(pipeline[0].item.content.filename)).toBe('flight-abc123.md');
    expect(String(notesItem!.item.content.filename)).toBe('flight-abc123-notes.txt');
  });

  const HEADERS = [
    'Flight Flighty ID',
    'Airline',
    'Flight',
    'From',
    'To',
    'Take off (Actual)',
    'Landing (Actual)',
    'Notes',
  ];

  async function writeFlightyCsv(rows: string[][], headers: string[] = HEADERS) {
    const tmp = await fs.promises.mkdtemp(path.join(tmpdir(), 'flighty-'));
    const fpath = path.join(tmp, 'FlightyExport-2024-09-01.csv');
    const body = [headers, ...rows].map((r) => r.join(',')).join('\n');
    await fs.promises.writeFile(fpath, body);

    return fpath;
  }

  it('skips a CSV missing a required Flighty column, warning instead of throwing', async () => {
    const importer = getImporter('flighty');
    // 'To' dropped from the header — a mislabeled or corrupt export.
    const headers = HEADERS.filter((h) => h !== 'To');
    const fpath = await writeFlightyCsv(
      [['abc123', 'MyAir', 'MX100', 'AAA', '2024-09-01T10:00', '2024-09-01T12:00', '']],
      headers,
    );
    const logs: unknown[] = [];
    const pipeline: EmittedGraph[] = [];
    await importer.fileImport(
      {},
      { filename: fpath } as DirEntry,
      {
        pipeline,
        log: (level: string, msg: string) => logs.push([level, msg]),
      } as unknown as ImportParams,
    );
    expect(pipeline.length).toBe(0);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['warn', expect.stringContaining("missing required 'To'")]),
      ]),
    );
  });

  it('imports a flight with an unparseable Take off (Actual) date as undated rather than dropping it', async () => {
    const importer = getImporter('flighty');
    // Not the expected YYYY-MM-DDTHH:MM shape (e.g. an export from a locale
    // that stamps dates differently) — parseLocalDate returns undefined for it.
    const fpath = await writeFlightyCsv([
      ['abc123', 'MyAir', 'MX100', 'AAA', 'BBB', '09/01/2024 10:00 AM', '2024-09-01T12:00', ''],
    ]);
    const pipeline: EmittedGraph[] = [];
    await importer.fileImport({}, { filename: fpath } as DirEntry, { pipeline } as unknown as ImportParams);
    expect(pipeline.length).toBe(1);
    expect(pipeline[0].item.timestamp).toBeUndefined();
    expect(pipeline[0].item.metadata['Flight number']).toBe('MX100');
  });

  /**
   * Regression coverage for flighty.ts's fileImport never calling
   * timeframeContains: every sibling importer in this directory gates a
   * pushed row on params.timeframe so a date-bounded re-import doesn't
   * re-pull the whole export. This fixture has one flight inside the
   * requested window and one before it; only the in-window flight may reach
   * the pipeline.
   */
  it('excludes flights outside the requested timeframe', async () => {
    const importer = getImporter('flighty');
    const fpath = await writeFlightyCsv([
      ['in-range', 'MyAir', 'MX100', 'AAA', 'BBB', '2024-09-01T10:00', '2024-09-01T12:00', ''],
      ['too-early', 'MyAir', 'MX200', 'CCC', 'DDD', '2024-01-01T10:00', '2024-01-01T12:00', ''],
    ]);
    const pipeline: EmittedGraph[] = [];
    await importer.fileImport(
      {},
      { filename: fpath } as DirEntry,
      {
        pipeline,
        timeframe: { since: new Date('2024-06-01T00:00:00Z') },
      } as unknown as ImportParams,
    );
    expect(pipeline.length).toBe(1);
    expect(pipeline[0].item.metadata['Flight number']).toBe('MX100');
  });
});
