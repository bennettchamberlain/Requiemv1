import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { statedPhoneNumbers } from '@ci/domains/memory';

import { toGraphEntity } from '../../push/entities';
import { entityIdentityKey, hasContactIdentity, resolveEntityType } from '../../staging/identity';
import { ContactListFileImporter } from '../contactlist';
import type { DirEntry } from '../registry';
import type { EntityAttribute, Graph, ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';
import { stagedEntityStore } from './support/stagedEntities';

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

  /**
   * bestColumnMapping scores every FormatDef in `formats` (contactlist.ts:30-65)
   * against the header and keeps whichever maps the most distinct canonical
   * fields. Only the Google Contacts dialect was ever exercised — a scoring
   * regression that made the wrong dialect win (or a header this dialect's
   * regexes fail to match at all) would pass silently. "First Name,Last
   * Name,Mobile Phone" only matches Outlook's column regexes (Generic's PHONE
   * regex requires the header to read exactly "phone"/"phone number", not
   * "Mobile Phone" — see contactlist.ts:59 vs :49), so a correct entity here
   * proves the Outlook dialect specifically won, not Generic falling back.
   */
  it('maps the Outlook / Microsoft Contacts column dialect', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-contactlist-outlook-'));
    const file = path.join(dir, 'contacts.csv');
    fs.writeFileSync(file, 'First Name,Last Name,Mobile Phone\nBob,Builder,555-0100');
    const { params, collected } = makeParams();
    await new ContactListFileImporter().fileImport(
      undefined,
      { fullPath: file } as DirEntry,
      params as unknown as ImportParams,
    );
    expect(collected.length).toBe(1);
    const ent = collected[0].entity;
    expect(ent!.name).toBe('Bob Builder');
    expect(ent!.attributes).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'phone', value: '555-0100' })]),
    );
  });

  /**
   * "Full Name,Phone Number,Email Address,DOB" only matches the Generic
   * dialect's regexes (Outlook's EMAIL regex wants "...address" but its PHONE
   * regex wants a "<carrier> Phone" header, which "Phone Number" is not; see
   * contactlist.ts:52-65), covering the third FormatDef that had no test.
   */
  it('maps the Generic column dialect', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-contactlist-generic-'));
    const file = path.join(dir, 'contacts.csv');
    fs.writeFileSync(
      file,
      'Full Name,Phone Number,Email Address,DOB\nCarla Cruz,555-0200,carla@example.com,1988-03-04',
    );
    const { params, collected } = makeParams();
    await new ContactListFileImporter().fileImport(
      undefined,
      { fullPath: file } as DirEntry,
      params as unknown as ImportParams,
    );
    expect(collected.length).toBe(1);
    const ent = collected[0].entity;
    expect(ent!.name).toBe('Carla Cruz');
    expect(ent!.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'phone', value: '555-0200' }),
        expect.objectContaining({ name: 'email', value: 'carla@example.com' }),
        expect.objectContaining({ name: 'birth_date', value: '1988-03-04' }),
      ]),
    );
  });

  /**
   * The "minimal usefulness" filter (contactlist.ts:182) drops a row unless it
   * has >= 2 mapped attributes, OR exactly a name plus 1 attribute. Below is
   * one row per branch of that filter, all under the same Generic header so
   * only the filter — not format selection — is under test.
   */
  it('drops rows below the minimal-usefulness threshold and keeps the rest', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-contactlist-minimal-'));
    const file = path.join(dir, 'contacts.csv');
    fs.writeFileSync(
      file,
      [
        'Full Name,Phone Number,Email Address,DOB',
        ',555-1111,,', // no name, 1 attribute -> dropped
        'Dana Diaz,,,', // name, 0 attributes -> dropped (not the name+1 carve-out)
        'Eve Evans,,eve@example.com,', // name + 1 attribute -> kept
        ',555-2222,frank@example.com,', // no name, 2 attributes -> kept
      ].join('\n'),
    );
    const { params, collected } = makeParams();
    await new ContactListFileImporter().fileImport(
      undefined,
      { fullPath: file } as DirEntry,
      params as unknown as ImportParams,
    );
    const names = collected.map((c) => c.entity?.name);
    expect(names).toEqual(['Eve Evans', '']);
    expect(collected[1].entity!.attributes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'phone', value: '555-2222' }),
        expect.objectContaining({ name: 'email', value: 'frank@example.com' }),
      ]),
    );
  });

  /**
   * A row whose cell count doesn't match the header is skipped outright
   * (contactlist.ts:148) rather than imported with missing trailing fields —
   * this is what stops a truncated/short CSV line from silently becoming a
   * contact with the wrong values shifted into the wrong columns.
   */
  it('skips a row whose column count does not match the header', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-contactlist-malformed-'));
    const file = path.join(dir, 'contacts.csv');
    fs.writeFileSync(
      file,
      [
        'Full Name,Phone Number,Email Address,DOB',
        'Grace Green,555-3333,grace@example.com,1985-05-05',
        'Hank Hill,555-4444', // missing Email Address and DOB cells -> malformed, skipped
        'Ivy Iverson,555-5555,ivy@example.com,1992-02-02',
      ].join('\n'),
    );
    const { params, collected } = makeParams();
    await new ContactListFileImporter().fileImport(
      undefined,
      { fullPath: file } as DirEntry,
      params as unknown as ImportParams,
    );
    const names = collected.map((c) => c.entity?.name);
    expect(names).toEqual(['Grace Green', 'Ivy Iverson']);
  });

  /**
   * The `Photo` column (Google Contacts' own export header) was recognized by
   * the header-canonicalization table (CANON.PICTURE) but its value was never
   * read anywhere — a genuine avatar URL, sitting parsed and then discarded.
   * `properties.avatar_url` is the exact key `PersonType.avatarUrl` reads
   * (backend/.../graphql/types/PersonType.ts) and `push/entities.ts` spreads
   * `entity.metadata` straight into `ci.entities.properties`, so this is the
   * whole path from CSV cell to what the People page renders.
   */
  it('carries the Photo column through as properties.avatar_url', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-contactlist-photo-'));
    const file = path.join(dir, 'contacts.csv');
    fs.writeFileSync(
      file,
      'Name,E-mail 1 - Value,Phone 1 - Value,Photo\n' +
        'Jill Jones,jill@example.com,555-6666,https://contacts.google.com/photo/jill.jpg',
    );
    const { params, collected } = makeParams();
    await new ContactListFileImporter().fileImport(
      undefined,
      { fullPath: file } as DirEntry,
      params as unknown as ImportParams,
    );

    expect(collected[0].entity?.metadata?.avatar_url).toBe('https://contacts.google.com/photo/jill.jpg');
  });

  it('does not treat a non-URL Photo cell as an avatar_url', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-contactlist-photo-bad-'));
    const file = path.join(dir, 'contacts.csv');
    fs.writeFileSync(
      file,
      'Name,E-mail 1 - Value,Phone 1 - Value,Photo\nKen Kelly,ken@example.com,555-7777,IMG_0001.HEIC',
    );
    const { params, collected } = makeParams();
    await new ContactListFileImporter().fileImport(
      undefined,
      { fullPath: file } as DirEntry,
      params as unknown as ImportParams,
    );

    expect(collected[0].entity?.metadata?.avatar_url).toBeUndefined();
  });

  /**
   * An Outlook export's "Company Main Phone" column puts the switchboard on
   * every colleague's row. Keyed on its smallest handle, each row keyed on that
   * number — digits sort before letters — and staging collapsed the rows into
   * ONE entity. This parser declares no `accumulate`, so the second and third
   * colleagues did not even survive as extra names: they vanished.
   */
  it('keys colleagues who share a company main line apart', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-contactlist-office-'));
    const file = path.join(dir, 'contacts.csv');
    fs.writeFileSync(
      file,
      [
        'First Name,Last Name,E-mail Address,Company Main Phone,Mobile Phone',
        'Priya,Natarajan,priya@example.com,555-010-0100,',
        'Tom,Becker,tom@example.com,555-010-0100,',
        'Lena,Ortiz,,555-010-0100,555-010-0142',
      ].join('\n'),
    );
    const { params, collected } = makeParams();
    await new ContactListFileImporter().fileImport(
      undefined,
      { fullPath: file } as DirEntry,
      params as unknown as ImportParams,
    );

    const entities = collected.map((g) => g.entity!);
    expect(entities.map((e) => e.name)).toEqual(['Priya Natarajan', 'Tom Becker', 'Lena Ortiz']);
    expect(entities.map(entityIdentityKey)).toEqual(['priya@example.com', 'tom@example.com', '5550100142']);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * A row's numbers as typed, beside the normalized keys staging indexes.
 *
 * Staging records every email and phone a contact states under `emails` /
 * `phones` (`withContactIdentifiers`), a phone as its last ten digits — which
 * have lost the country the typed number states. `Phones` keeps the typed form
 * for the phone adjudicator and the merge union, as the vCard parser's does.
 * The staged tests go through the real writer (support/stagedEntities.ts), then
 * the push's `toGraphEntity`.
 */
describe("a contact-list row's numbers as typed", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-contactlist-phones-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeCsv(lines: string[]): DirEntry {
    const file = path.join(dir, 'contacts.csv');
    fs.writeFileSync(file, lines.join('\n'));

    return { fullPath: file } as DirEntry;
  }

  async function parse(entry: DirEntry): Promise<EmittedGraph[]> {
    const { params, collected } = makeParams();
    await new ContactListFileImporter().fileImport(undefined, entry, params as unknown as ImportParams);

    return collected;
  }

  async function stage(entry: DirEntry) {
    const store = stagedEntityStore('contact_list');
    await new ContactListFileImporter().fileImport(undefined, entry, {
      pipeline: store.writer,
      timeframe: undefined,
    } as unknown as ImportParams);
    await store.writer.settled();

    return store;
  }

  const sorted = (value: unknown): unknown =>
    Array.isArray(value) ? [...(value as string[])].sort() : value;

  // Google Contacts writes a label's several values into one cell, joined by
  // ` ::: ` — two Mobile numbers in `Phone 1` — and `Phone 2` repeats one.
  const GOOGLE_HEADER = 'Name,E-mail 1 - Value,Phone 1 - Type,Phone 1 - Value,Phone 2 - Type,Phone 2 - Value';
  const ana = 'Ana Whitcombe,ana@example.org,Mobile,+1 415-555-0123 ::: +1 415-555-0145,Work,+1 415-555-0145';

  it('splits ` ::: ` cells into one Phones entry per number, once each, as typed', async () => {
    const [graph] = await parse(writeCsv([GOOGLE_HEADER, ana]));

    expect(graph.entity?.metadata?.Phones).toEqual(['+1 415-555-0123', '+1 415-555-0145']);
    expect(graph.entity?.accumulate).toEqual(['Phones']);
    // Typed emails have no reader: staging's normalized `emails` is what is indexed.
    expect(graph.entity?.metadata).not.toHaveProperty('Emails');
  });

  it('leaves a joined cell whole in the attributes, so the natural key does not move', async () => {
    const [graph] = await parse(writeCsv([GOOGLE_HEADER, ana]));

    expect(graph.entity?.attributes).toEqual(
      expect.arrayContaining([
        { name: 'phone', value: '+1 415-555-0123 ::: +1 415-555-0145', identity: true },
        { name: 'phone', value: '+1 415-555-0145', identity: true },
      ]),
    );
    // The joined cell's digits run together and the last ten win — the second
    // number — exactly as this row keyed before the typed list existed.
    expect(entityIdentityKey(graph.entity!)).toBe('4155550145');
  });

  it('keys and types rows exactly as before, with and without a number', async () => {
    const [card, handleless] = (
      await parse(
        writeCsv([
          'Full Name,Phone Number,Email Address,DOB',
          'Omar Haddad,(212) 555-0199,,',
          'Lena Park,,,1990-06-01',
        ]),
      )
    ).map((graph) => graph.entity!);

    expect(card.attributes).toEqual([{ name: 'phone', value: '(212) 555-0199', identity: true }]);
    expect(card.metadata?.Phones).toEqual(['(212) 555-0199']);
    expect(entityIdentityKey(card)).toBe('2125550199');
    expect(hasContactIdentity(card)).toBe(true);
    expect(resolveEntityType(card)).toBe('contact');

    expect(handleless.metadata).not.toHaveProperty('Phones');
    expect(entityIdentityKey(handleless)).toBeNull();
    expect(hasContactIdentity(handleless)).toBe(false);
    expect(resolveEntityType(handleless)).toBe('contact');
  });

  it('hands the phone adjudicator every number in a joined cell, with its country', async () => {
    const store = await stage(writeCsv([GOOGLE_HEADER, ana]));
    const [row] = store.staged();
    const dto = toGraphEntity(row);

    expect(dto?.key).toBe('contact:4155550145');
    expect(dto?.properties?.Phones).toEqual(['+1 415-555-0123', '+1 415-555-0145']);
    expect(sorted(statedPhoneNumbers(dto?.properties, dto?.name))).toEqual(['+14155550123', '+14155550145']);
  });

  it('lists every phone column of an Outlook row, as typed', async () => {
    const store = await stage(
      writeCsv([
        'First Name,Last Name,E-mail Address,Mobile Phone,Home Phone',
        'Omar,Haddad,omar@example.com,(212) 555-0161,+1 212 555 0104',
      ]),
    );
    const [row] = store.staged();
    const dto = toGraphEntity(row);

    expect(row.identityKey).toBe('2125550104');
    expect(dto?.properties?.Phones).toEqual(['(212) 555-0161', '+1 212 555 0104']);
    expect(dto?.properties?.phones).toEqual(['2125550104', '2125550161']);
    expect(statedPhoneNumbers(dto?.properties, dto?.name)).toEqual(['+12125550104']);
  });

  it('grows one staged row when the same contact is listed twice', async () => {
    // Google keeps duplicate contacts as separate rows until someone merges
    // them; both key on the shared number, and the second lists a number the
    // first does not.
    const store = await stage(
      writeCsv([
        'Name,E-mail 1 - Value,Phone 1 - Value,Phone 2 - Value',
        'Dev Anand,dev@example.com,(415) 555-0150,',
        'Dev Anand,dev.anand@example.org,+1 415 555 0150,+1 415 555 0190',
      ]),
    );

    expect(store.writer.totals).toMatchObject({ entities: 1, entitiesGrown: 1 });

    const [row] = store.staged();
    expect(row.identityKey).toBe('4155550150');
    expect(row.metadata.Phones).toEqual(['(415) 555-0150', '+1 415 555 0150', '+1 415 555 0190']);
    expect(sorted(statedPhoneNumbers(toGraphEntity(row)?.properties, row.name))).toEqual([
      '+14155550150',
      '+14155550190',
    ]);
  });
});
