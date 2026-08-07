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
  });
});
