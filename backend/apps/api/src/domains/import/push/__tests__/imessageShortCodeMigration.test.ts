import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import Database from 'better-sqlite3';
import { v5 as uuidv5 } from 'uuid';

import { GraphIngestService } from '../../../graph/services/GraphIngestService';
import { INDEX_EMBED_PERSON_SOURCE } from '../../../pipeline/stages/index/entityEmbedStages';
// Side-effect import: this is what registers the datasource with the registry
// `allDataSources` reads. `iMessageFileImporter` is not exported.
import '../../datasources/imessage';
import type { DirEntry } from '../../datasources/registry';
import { allDataSources } from '../../datasources/registry';
import type { Entity, Graph, ImportParams, Relationship } from '../../datasources/timeline';
import type { StagedEntity } from '../../entities/StagedEntityEntity';
import { entityIdentityKey, isShortCode, resolveEntityType } from '../../staging/identity';
import { entityTypeFor, naturalKeyFor } from '../entities';

/**
 * The repair migration for the iMessage SMS short codes that landed as
 * `Person`, tested where it can actually break.
 *
 * `20260819150902_retype_imessage_short_code_people_as_concepts.sql`
 * re-derives, in SQL, four things that live in TypeScript: the natural key
 * (`naturalKeyFor`), the uuidv5 namespace it is hashed under
 * (`GraphIngestService`'s private `IMPORT_NAMESPACE`, "do not change — it is
 * the idempotency anchor"), the staged-type → `ci.entities.entity_type` mapping
 * (`entityTypeFor`) and the short-code rule (`isShortCode`). None of those
 * couplings is visible from either side: the SQL cannot import the constants,
 * and nothing in the code mentions the migration.
 *
 * So this reads the migration file and checks the literals it hard-codes
 * against the functions that produced the rows it repairs, driving them from a
 * real parsed chat.db rather than a hand-written staged row.
 *
 * Modelled on `googleVoiceShortCodeMigration.test.ts`, which does the same for
 * the Google Voice half of this defect class. It carries one assertion that one
 * does not: unlike a Google Voice short code, an iMessage one is a `Person` and
 * therefore INDEXED, so the migration has search rows to dismantle and the
 * predicate that made them stale has to keep saying `Person`.
 */
const MIGRATION_SUFFIX = '_retype_imessage_short_code_people_as_concepts.sql';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../../db/postgres/migrations');

function migrationSql(): string {
  const file = fs.readdirSync(MIGRATIONS_DIR).find((name) => name.endsWith(MIGRATION_SUFFIX));

  if (file == null) {
    throw new Error(`No migration ending in ${MIGRATION_SUFFIX} in ${MIGRATIONS_DIR}`);
  }

  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
}

/** Every distinct uuid literal the migration hashes under. */
function namespaceLiterals(sql: string): string[] {
  const matches = sql.matchAll(/uuid_generate_v5\(\s*'([0-9a-f-]{36})'::uuid/gi);

  return [...new Set([...matches].map((m) => m[1]))];
}

/** The `'<prefix>:' || lower(btrim(...))` prefixes, in the order they appear. */
function keyPrefixes(sql: string): string[] {
  const matches = sql.matchAll(/'([a-z_]+):'\s*\|\|\s*lower\(btrim\(/gi);

  return [...new Set([...matches].map((m) => m[1]))];
}

/** The digit-count bounds the SQL's short-code predicate accepts. */
function digitBounds(sql: string): [number, number] {
  const match = /BETWEEN (\d+) AND (\d+)/.exec(sql);

  if (match == null) {
    throw new Error('the migration no longer bounds the short code by digit count');
  }

  return [Number(match[1]), Number(match[2])];
}

function getImporter() {
  const ds = allDataSources().find((d) => d.name === 'imessage');

  if (!ds?.newFileImporter) {
    throw new Error('missing importer');
  }

  return ds.newFileImporter();
}

/**
 * One inbound iMessage from `handle`, parsed by the real importer, returning
 * the entity it staged on the message's `participant` edge — the only place
 * this datasource stages a conversation partner.
 */
async function stagedEntity(handle: string): Promise<Entity> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'imsg-migration-'));
  const db = new Database(path.join(dir, 'chat.db'));
  db.exec(`
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY, id TEXT);
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY, guid TEXT, date INTEGER, text TEXT, is_from_me INTEGER, service TEXT, handle_id INTEGER);
    CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY, guid TEXT, filename TEXT, mime_type TEXT);
    CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);
  `);
  db.prepare('INSERT INTO handle (ROWID, id) VALUES (1, ?)').run(handle);
  db.prepare(
    'INSERT INTO message (ROWID, guid, date, text, is_from_me, service, handle_id) VALUES (1,?,?,?,0,?,1)',
  ).run('msg-guid-1', 600000000, 'your code is 402931', 'SMS');
  db.close();

  const pushed: Graph[] = [];
  await getImporter().fileImport(
    {},
    { filename: dir, fullPath: dir } as DirEntry,
    {
      pipeline: { push: (g: Graph) => pushed.push(g) },
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams,
  );

  const entity = pushed.flatMap((g) => g.edges ?? []).find((e: Relationship) => e.relation === 'participant')
    ?.to.entity;

  if (entity == null) {
    throw new Error(`the fixture chat.db staged no participant for ${handle}`);
  }

  return entity;
}

/**
 * A staged row as `StagedWriter` would write it: the type is
 * `resolveEntityType`'s answer, and `identityKey` is the entity's normalized
 * handle — null for a short code, which is the only reason `naturalKeyFor`
 * falls back to the name at all.
 */
function staged(entity: Entity): StagedEntity {
  return {
    type: resolveEntityType(entity),
    name: entity.name,
    identityKey: entityIdentityKey(entity),
    dataSource: 'imessage',
    metadata: {},
  } as StagedEntity;
}

/**
 * The parser as it was: `contactEntity` declared `type: 'contact'` for every
 * handle in chat.db, which is what minted the rows the migration repairs.
 * Restated rather than derived, because the declaration it stood for is gone —
 * but it is the only literal here, and reverting the fix collapses `postFix`
 * onto it, which every assertion below then rejects.
 */
const preFix = (entity: Entity): StagedEntity => staged({ ...entity, type: 'contact' });
const postFix = (entity: Entity): StagedEntity => staged(entity);

describe('the iMessage short-code migration agrees with the code that minted the rows', () => {
  /** "888222" — a real SMS short code from the QA corpus. */
  let shortCode: Entity;
  /** The same message from a number a person can be reached on. */
  let realPhone: Entity;

  beforeAll(async () => {
    shortCode = await stagedEntity('888222');
    realPhone = await stagedEntity('+15558887777');
  });

  it('is present, and hashes under exactly one namespace', () => {
    expect(namespaceLiterals(migrationSql())).toHaveLength(1);
  });

  it('hashes under the namespace GraphIngestService derives linked_id with', () => {
    const [namespace] = namespaceLiterals(migrationSql());

    // Not a comparison of two constants: the right-hand side is the real
    // derivation the ingest performs, so this fails if IMPORT_NAMESPACE moves
    // even though the migration cannot import it.
    expect(GraphIngestService.linkedIdFor('short_code:888222')).toBe(uuidv5('short_code:888222', namespace));
  });

  it('scopes on the key the BROKEN parser produced and writes the key the FIXED one produces', () => {
    // Order matters: the SQL selects rows by the `contact:` key and moves them
    // to the `short_code:` key, and swapping them would re-key nothing and
    // match nothing. Note the scope prefix is `contact:`, NOT the `entity:` the
    // two sibling migrations scope on — this parser always declared a type.
    expect(keyPrefixes(migrationSql())).toEqual(['short_code', 'contact']);

    expect(naturalKeyFor(preFix(shortCode))).toBe('contact:888222');
    expect(naturalKeyFor(postFix(shortCode))).toBe('short_code:888222');
  });

  it('retypes: a short code was a Person and is now a Concept', () => {
    // The whole difference from 20260819145023, which retypes nothing.
    expect(entityTypeFor(preFix(shortCode))).toBe('Person');
    expect(entityTypeFor(postFix(shortCode))).toBe('Concept');

    const sql = migrationSql();

    expect(sql).toContain("e.entity_type = 'Person'");
    expect(sql).toContain("SET entity_type = 'Concept'");
  });

  it('falls back to the name because the short code is not a handle', () => {
    // The load-bearing half of the scope predicate: the SQL matches a row whose
    // linked_id was derived from its own NAME, which is only what
    // `naturalKeyFor` produces when `entityIdentityKey` refused the handle.
    expect(entityIdentityKey(shortCode)).toBeNull();
    expect(entityIdentityKey(realPhone)).toBe('5558887777');
  });

  it('deletes the person-search rows, because the retype makes the sweep blind to them', () => {
    const sql = migrationSql();

    // The coupling that makes those deletes necessary rather than tidy: both
    // person index stages share this source, and it selects on `Person`. If it
    // ever stopped doing so, a retyped row would be re-indexed on the next
    // sweep and deleting its rows here would be wrong.
    expect(INDEX_EMBED_PERSON_SOURCE.predicate).toContain("s.entity_type = 'Person'");

    expect(sql).toContain('DELETE FROM ci_search.vectors');
    expect(sql).toContain('DELETE FROM ci_search.embeddings');
    expect(sql).toContain('DELETE FROM ci.pipeline_state');

    // The entity itself survives — it is a real correspondent, and 2,641
    // communications on the QA corpus point at it.
    expect(sql).not.toContain('DELETE FROM ci.entities');
    expect(sql).not.toContain('DELETE FROM ci.communications');
    // `ci.entity_identifiers` holds this row's kind-'name' row, which is
    // exactly what the already-correct Google Voice short-code Concepts carry.
    expect(sql).not.toContain('DELETE FROM ci.entity_identifiers');
  });

  it('leaves a real phone number alone: still a Person, and still keyed on its handle', () => {
    // The population the migration must not touch. A handle-keyed row never
    // satisfies the `contact:<name>` scope predicate, because `naturalKeyFor`
    // only falls back to the name when there is no handle.
    expect(entityTypeFor(postFix(realPhone))).toBe('Person');
    expect(naturalKeyFor(postFix(realPhone))).toBe('contact:5558887777');
  });

  it('bounds the short code at the same digit count isShortCode does', () => {
    const [min, max] = digitBounds(migrationSql());

    // The SQL's `BETWEEN min AND max` and `isShortCode` have to draw the line in
    // the same place, or the migration re-keys rows the parser now types as
    // contacts (or skips ones it types as short codes).
    expect(isShortCode('4'.repeat(min))).toBe(true);
    expect(isShortCode('4'.repeat(max))).toBe(true);
    expect(isShortCode('4'.repeat(max + 1))).toBe(false);
    expect(isShortCode('')).toBe(false);
  });

  it('names the source system the iMessage parser pushes under', () => {
    // `linked_table` is `import:<dataSource>`, and `imessage` is the `name` the
    // importer registers with.
    expect(migrationSql()).toContain("'import:imessage'");
  });
});
