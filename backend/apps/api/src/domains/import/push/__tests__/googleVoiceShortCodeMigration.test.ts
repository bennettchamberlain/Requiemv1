import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { v5 as uuidv5 } from 'uuid';

import { GraphIngestService } from '@ci/domains/graph';

import { GoogleVoiceFileImporter } from '../../datasources/googlevoice';
import type { Entity, ImportParams } from '../../datasources/timeline';
import type { StagedEntity } from '../../entities/StagedEntityEntity';
import { entityIdentityKey, isShortCode, resolveEntityType } from '../../staging/identity';
import { entityTypeFor, naturalKeyFor } from '../entities';

/**
 * The repair migration for the Google Voice participants that landed as
 * `Concept`, tested where it can actually break.
 *
 * `20260819145023_rekey_google_voice_short_code_concepts.sql` re-derives, in
 * SQL, four things that live in TypeScript: the natural key (`naturalKeyFor`),
 * the uuidv5 namespace it is hashed under (`GraphIngestService`'s private
 * `IMPORT_NAMESPACE`, "do not change — it is the idempotency anchor"), the
 * staged-type → `ci.entities.entity_type` mapping (`entityTypeFor`) and the
 * short-code rule (`isShortCode`). None of those couplings is visible from
 * either side: the SQL cannot import the constants, and nothing in the code
 * mentions the migration.
 *
 * So this reads the migration file and checks the literals it hard-codes
 * against the functions that produced the rows it repairs, driving them from a
 * real parsed Google Voice export rather than a hand-written staged row. A
 * drift in either direction — someone re-namespacing the import keys, someone
 * dropping the parser's declared type, someone editing a prefix or the digit
 * bounds in the SQL — fails here instead of silently re-breaking a corpus on
 * the next import.
 *
 * Modelled on `contactConceptRetypeMigration.test.ts`, which does the same for
 * the vCard half of this defect class.
 */
const MIGRATION_SUFFIX = '_rekey_google_voice_short_code_concepts.sql';

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

/**
 * One inbound Google Voice text, parsed by the real importer, returning every
 * entity it staged — both the standalone pushes and the `participant` edge,
 * because all three declare the type and all three have to agree.
 */
async function stagedEntities(tel: string, fn: string): Promise<Entity[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-migration-'));
  fs.mkdirSync(path.join(dir, 'Calls'));
  fs.writeFileSync(
    path.join(dir, 'Phones.vcf'),
    'BEGIN:VCARD\nVERSION:3.0\nFN:My Phone\nTEL:+15551234567\nEND:VCARD\n',
  );
  fs.writeFileSync(
    path.join(dir, 'Calls', `${fn} - Text - 2025-03-01T12_00_00Z.html`),
    `<html><body><div class="hChatLog hfeed"><div class="message">
       <abbr class="dt" title="2025-03-01T12:00:00.000Z">Mar 1</abbr>:
       <cite class="sender vcard"><a class="tel" href="tel:${tel}"><span class="fn">${fn}</span></a></cite>:
       <q>your code is 402931</q>
     </div></div></body></html>`,
  );

  const pipeline: { entity?: Entity; edges?: { relation: string; to: { entity?: Entity } }[] }[] = [];
  await new GoogleVoiceFileImporter().fileImport({}, { filename: path.basename(dir), fullPath: dir }, {
    pipeline,
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams);

  const out = pipeline.flatMap((g) => [
    ...(g.entity ? [g.entity] : []),
    ...(g.edges ?? [])
      .filter((e) => e.relation === 'participant')
      .flatMap((e) => (e.to.entity ? [e.to.entity] : [])),
  ]);

  if (out.length === 0) {
    throw new Error('the fixture export staged no entity at all');
  }

  return out;
}

/**
 * A staged row as `StagedWriter` would write it: the type is
 * `resolveEntityType`'s answer, and `identityKey` is the entity's normalized
 * handle — null for a short code, which is the only reason `naturalKeyFor`
 * falls back to the name at all.
 */
function staged(entity: Entity, stripDeclaredType: boolean): StagedEntity {
  const source = stripDeclaredType ? { ...entity, type: undefined } : entity;

  return {
    type: resolveEntityType(source),
    name: source.name,
    identityKey: entityIdentityKey(source),
    dataSource: 'google_voice',
    metadata: {},
  } as StagedEntity;
}

/**
 * Today's parser, and the same parser with its `type` declaration taken away —
 * which is exactly what the two entity pushes were before this change and
 * exactly what produced the rows the migration repairs. Both read the entity
 * from the parser rather than restating it, so reverting the declaration fails
 * these tests.
 */
const postFix = (entities: Entity[]): StagedEntity[] => entities.map((e) => staged(e, false));
const preFix = (entities: Entity[]): StagedEntity[] => entities.map((e) => staged(e, true));

describe('the Google Voice short-code migration agrees with the code that minted the rows', () => {
  /** "411" — a real SMS short code from the QA corpus. */
  let shortCode: Entity[];
  /** The same message from a number a person can be reached on. */
  let realPhone: Entity[];

  beforeAll(async () => {
    shortCode = await stagedEntities('411', '411');
    realPhone = await stagedEntities('+15558887777', 'Dana Wu');
  });

  it('is present, and hashes under exactly one namespace', () => {
    expect(namespaceLiterals(migrationSql())).toHaveLength(1);
  });

  it('hashes under the namespace GraphIngestService derives linked_id with', () => {
    const [namespace] = namespaceLiterals(migrationSql());

    // Not a comparison of two constants: the right-hand side is the real
    // derivation the ingest performs, so this fails if IMPORT_NAMESPACE moves
    // even though the migration cannot import it.
    expect(GraphIngestService.linkedIdFor('short_code:411')).toBe(uuidv5('short_code:411', namespace));
  });

  it('scopes on the key the BROKEN parser produced and writes the key the FIXED one produces', () => {
    // Order matters: the SQL selects rows by the `entity:` key and moves them
    // to the `short_code:` key, and swapping them would re-key nothing and
    // match nothing.
    expect(keyPrefixes(migrationSql())).toEqual(['short_code', 'entity']);

    // Every push in the file agrees, so the migration has one target per row
    // rather than a coin toss between the standalone entity and the edge.
    expect(preFix(shortCode).map(naturalKeyFor)).toEqual(['entity:411', 'entity:411']);
    expect(postFix(shortCode).map(naturalKeyFor)).toEqual(['short_code:411', 'short_code:411']);
  });

  it('does not retype anything: a short code is a Concept on both sides of the fix', () => {
    // The whole difference from 20260819092314, which retypes to `Person`.
    expect(preFix(shortCode).map(entityTypeFor)).toEqual(['Concept', 'Concept']);
    expect(postFix(shortCode).map(entityTypeFor)).toEqual(['Concept', 'Concept']);

    const sql = migrationSql();

    expect(sql).toContain("e.entity_type = 'Concept'");
    expect(sql).not.toContain('SET entity_type');
  });

  it('leaves a real phone number alone: still a Person, and still keyed on its handle', () => {
    // The population the migration must not touch. A handle-keyed row never
    // satisfies the `entity:<name>` scope predicate, because `naturalKeyFor`
    // only falls back to the name when there is no handle.
    expect(postFix(realPhone).map(entityTypeFor)).toEqual(['Person', 'Person']);
    expect(postFix(realPhone).map(naturalKeyFor)).toEqual(['contact:5558887777', 'contact:5558887777']);
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

  it('names the source system the Google Voice parser pushes under', () => {
    // `linked_table` is `import:<dataSource>`, and `google_voice` is the `name`
    // the importer registers with.
    expect(migrationSql()).toContain("'import:google_voice'");
  });
});
