import path from 'path';

import { AppleContactsFileImporter } from '../applecontacts';
import type { EntityAttribute, ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Apple Contacts datasource', () => {
  it('recognizes AddressBook-v22.abcddb file', async () => {
    const dbPath = path.join(FIXTURES_DIR, 'AddressBook-v22.abcddb');
    const fi = new AppleContactsFileImporter();
    const rec = await fi.recognize({}, { filename: 'AddressBook-v22.abcddb', fullPath: dbPath });
    expect(rec.confidence).toBe(1.0);
  });

  it('imports Apple contacts', async () => {
    const dbPath = path.join(FIXTURES_DIR, 'AddressBook-v22.abcddb');
    const fi = new AppleContactsFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'AddressBook-v22.abcddb', fullPath: dbPath }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const entities = pipeline.filter((p) => p.entity);
    expect(entities.length).toBe(1);
    expect(entities[0].entity!.name).toBe('Alice Anderson');
    expect(entities[0].entity!.metadata?.Source).toBe('AppleContacts');
    expect(entities[0].entity!.attributes).toBeDefined();
    const phoneAttr = entities[0].entity!.attributes?.find((a: EntityAttribute) => a.name === 'phone');
    expect(phoneAttr?.value).toBe('+1-555-111-2222');
  });
});
