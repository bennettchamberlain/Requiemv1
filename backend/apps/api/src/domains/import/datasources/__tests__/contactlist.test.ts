import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ContactListFileImporter } from '../contactlist';
import type { DirEntry } from '../registry';
import type { EntityAttribute, Graph, ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

function makeParams() {
  const collected: EmittedGraph[] = [];

  return {
    params: { timeframe: undefined, pipeline: { push: (g: Graph) => collected.push(g as EmittedGraph) } },
    collected,
  };
}

describe('Contact List datasource', () => {
  it('recognizes and imports Google Contacts style CSV', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-contactlist-'));
    const file = path.join(dir, 'contacts.csv');
    fs.writeFileSync(
      file,
      'Name,Birthday,E-mail 1 - Value,Phone 1 - Value\nAlice Example,1990-01-02,alice@example.com,+1234567',
    );
    const imp = new ContactListFileImporter();
    const rec = await imp.recognize(undefined, { fullPath: file } as DirEntry);
    expect(rec.confidence).toBeGreaterThan(0.5);
    const { params, collected } = makeParams();
    await imp.fileImport(undefined, { fullPath: file } as DirEntry, params as unknown as ImportParams);
    expect(collected.length).toBe(1);
    const ent = collected[0].entity;
    expect(ent!.name).toBe('Alice Example');
    expect(
      ent!.attributes!.some((a: EntityAttribute) => a.name === 'email' && a.value === 'alice@example.com'),
    ).toBe(true);
  });
});
