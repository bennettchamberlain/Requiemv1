import fs from 'node:fs';
import path from 'node:path';

import { v5 as uuidv5 } from 'uuid';

import { GraphIngestService } from '@ci/domains/graph';

import {
  type ContentLine,
  buildContact,
  parseContentLine,
  unfoldContentLines,
} from '../../datasources/vcard';
import type { StagedEntity } from '../../entities/StagedEntityEntity';
import { resolveEntityType } from '../../staging/identity';
import { entityTypeFor, naturalKeyFor } from '../entities';

/**
 * The repair migration for the contact cards that landed as `Concept`, tested
 * where it can actually break.
 *
 * `20260819092314_retype_contact_sourced_concepts_as_people.sql` re-derives, in
 * SQL, three things that live in TypeScript: the natural key
 * (`naturalKeyFor`), the uuidv5 namespace it is hashed under
 * (`GraphIngestService`'s private `IMPORT_NAMESPACE`, "do not change — it is
 * the idempotency anchor") and the staged-type → `ci.entities.entity_type`
 * mapping (`entityTypeFor`). None of those couplings is visible from either
 * side: the SQL cannot import the constants, and nothing in the code mentions
 * the migration.
 *
 * So this reads the migration file and checks the four literals it hard-codes
 * against the functions that produced the rows it repairs, driving them from a
 * real parsed vCard rather than a hand-written staged row. A drift in either
 * direction — someone re-namespacing the import keys, someone dropping the
 * parser's `type: 'contact'`, someone editing a prefix in the SQL — fails here
 * instead of silently re-breaking a corpus on the next import.
 */
const MIGRATION_SUFFIX = '_retype_contact_sourced_concepts_as_people.sql';

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
  const matches = sql.matchAll(/'([a-z]+):'\s*\|\|\s*lower\(btrim\(/gi);

  return [...new Set([...matches].map((m) => m[1]))];
}

function contentLines(raw: string): ContentLine[] {
  const out: ContentLine[] = [];

  for (const line of unfoldContentLines(raw)) {
    const trimmed = line.trim();

    if (!trimmed || /^(BEGIN|END):VCARD$/i.test(trimmed)) {
      continue;
    }

    const parsed = parseContentLine(line);

    if (parsed) {
      out.push(parsed);
    }
  }

  return out;
}

/** The card at the centre of this: a name, a URL, no phone and no email. */
const NAME_ONLY_CARD = 'BEGIN:VCARD\nFN:Nadia Whitlock\nURL:https://example.invalid/in/nadia\nEND:VCARD\n';

/**
 * A staged row as `StagedWriter` would write it for this card: the type is
 * `resolveEntityType`'s answer, and `identityKey` is null because the card
 * carries no handle — which is the only reason `naturalKeyFor` falls back to
 * the name at all.
 */
function stagedFromCard(raw: string, stripDeclaredType: boolean): StagedEntity {
  const built = buildContact(contentLines(raw), 'contacts.vcf');

  if (built == null) {
    throw new Error('the fixture card did not parse');
  }

  const entity = stripDeclaredType ? { ...built.entity, type: undefined } : built.entity;

  return {
    type: resolveEntityType(entity),
    name: entity.name,
    identityKey: null,
    dataSource: 'vcard',
    metadata: {},
  } as StagedEntity;
}

/**
 * Today's parser, and the same parser with its `type` declaration taken away —
 * which is exactly what it was before PR #2131 and exactly what produced the
 * rows this migration repairs. `postFix` reads the declaration from the parser
 * rather than restating it, so reverting that one line fails these tests.
 */
const postFix = () => stagedFromCard(NAME_ONLY_CARD, false);
const preFix = () => stagedFromCard(NAME_ONLY_CARD, true);

describe('the contact-Concept repair migration agrees with the code that minted the rows', () => {
  it('is present, and hashes under exactly one namespace', () => {
    expect(namespaceLiterals(migrationSql())).toHaveLength(1);
  });

  it('hashes under the namespace GraphIngestService derives linked_id with', () => {
    const [namespace] = namespaceLiterals(migrationSql());

    // Not a comparison of two constants: the right-hand side is the real
    // derivation the ingest performs, so this fails if IMPORT_NAMESPACE moves
    // even though the migration cannot import it.
    expect(GraphIngestService.linkedIdFor('contact:nadia whitlock')).toBe(
      uuidv5('contact:nadia whitlock', namespace),
    );
  });

  it('scopes on the key the BROKEN parser produced and writes the key the FIXED one produces', () => {
    // Order matters: the SQL selects rows by the `entity:` key and moves them to
    // the `contact:` key, and swapping them would re-key nothing and match
    // nothing.
    expect(keyPrefixes(migrationSql())).toEqual(['contact', 'entity']);

    expect(naturalKeyFor(preFix())).toBe('entity:nadia whitlock');
    expect(naturalKeyFor(postFix())).toBe('contact:nadia whitlock');
  });

  it('moves rows between the two entity_types those two keys resolve to', () => {
    expect(entityTypeFor(preFix())).toBe('Concept');
    expect(entityTypeFor(postFix())).toBe('Person');

    const sql = migrationSql();

    expect(sql).toContain("e.entity_type = 'Concept'");
    expect(sql).toContain("SET entity_type = 'Person'");
  });

  it('names every source system the three contact parsers push under', () => {
    const sql = migrationSql();

    // `linked_table` is `import:<dataSource>`; these three are the `name`s the
    // vcard, contactlist and applecontacts importers register with.
    for (const source of ['import:vcard', 'import:contact_list', 'import:apple_contacts']) {
      expect(sql).toContain(`'${source}'`);
    }
  });
});
