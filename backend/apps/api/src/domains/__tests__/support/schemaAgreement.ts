import type { DataSource, EntityMetadata } from 'typeorm';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ENTITY ↔ MIGRATION DRIFT DETECTION, AS PLAIN FUNCTIONS OVER PLAIN DATA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CLAUDE.md states the rule: the SQL files in `db/postgres/migrations/` are
 * hand-written and are the SOURCE OF TRUTH; the TypeORM entities are updated to
 * match. Nothing in the type system enforces it. `synchronize` is off (it must
 * be — pointed at a real database it would be destructive), so TypeORM never
 * compares the two.
 *
 * That combination makes a drifted entity a uniquely nasty class of bug: `tsc`
 * is happy, because the entity is internally consistent TypeScript; every unit
 * test is happy, because they mock the repository and a mock agrees with
 * whatever the entity claims; and the first thing that notices is a
 * `QueryFailedError: column Foo.bar does not exist`, in production, on the first
 * request that happens to use a repository instead of a hand-written query.
 *
 * This module holds the comparison machinery a domain's agreement spec needs to
 * ask Postgres instead. It deliberately holds NO declarations: which entities
 * map to which tables is a per-domain statement, and it belongs in that domain's
 * spec where a reviewer of that migration will see it.
 *
 * Everything exported here is either a pure function over plain data or a thin
 * read of `information_schema`. The purity is the point — the pipeline domain's
 * spec feeds these functions hand-built drift and asserts each kind is caught,
 * so the checks are demonstrated to be falsifiable without a database on every
 * CI run, rather than merely passing on the day they were written.
 */

// ---------------------------------------------------------------------------
// Type families
// ---------------------------------------------------------------------------

/**
 * Postgres and TypeORM spell the same type several ways — `information_schema`
 * says `timestamp with time zone`, `udt_name` says `timestamptz`, the decorator
 * says `timestamptz`, and TypeORM's driver normalizes back to `timestamp with
 * time zone`. Folding all of them onto one token is what makes this DRIFT
 * detection rather than spelling enforcement.
 *
 * The folds are only ever between genuinely interchangeable spellings.
 * `timestamp` and `timestamptz` are kept apart because a column that quietly
 * loses its time zone is exactly the kind of bug this exists to catch, and
 * likewise `json` is not folded into `jsonb`.
 */
const TYPE_FAMILY_GROUPS: ReadonlyArray<readonly [family: string, spellings: readonly string[]]> = [
  ['uuid', ['uuid']],
  ['text', ['text', 'varchar', 'character varying', 'char', 'character', 'bpchar', 'citext', 'name']],
  ['integer', ['integer', 'int', 'int2', 'int4', 'int8', 'smallint', 'bigint', 'serial', 'bigserial']],
  ['timestamptz', ['timestamptz', 'timestamp with time zone']],
  ['timestamp', ['timestamp', 'timestamp without time zone']],
  ['jsonb', ['jsonb']],
  ['json', ['json']],
  ['boolean', ['bool', 'boolean']],
  ['numeric', ['numeric', 'decimal', 'float4', 'float8', 'real', 'double precision']],
  ['date', ['date']],
  ['bytea', ['bytea']],
];

const TYPE_FAMILIES = new Map<string, string>(
  TYPE_FAMILY_GROUPS.flatMap(([family, spellings]) =>
    spellings.map((spelling): [string, string] => [spelling, family]),
  ),
);

/**
 * Collapse one type spelling onto its family.
 *
 * An unrecognised type falls through as itself rather than throwing, so an
 * exotic column (a domain, an enum, `vector(768)`) still compares equal to the
 * same exotic column on the other side. Only a genuine difference fails.
 *
 * ARRAYS are a family of their own, one per element type: `text[]` never folds
 * onto `text`. The two sides spell them differently and neither spelling is the
 * one written in the migration — Postgres reports `TEXT[]` as the `udt_name`
 * `_text` (its internal array naming), while TypeORM keeps array-ness in
 * `ColumnMetadata.isArray` and normalizes the type to the bare element type. Both
 * are folded to `<element>[]` here so they compare equal to each other and to
 * nothing else. An entity that dropped `array: true` would otherwise read as
 * agreeing with the column while TypeORM wrote scalars into it.
 */
export function typeFamily(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    // `character varying(255)`, `numeric(10,2)` — the modifier is not the type.
    .replace(/\s*\([^)]*\)/g, '')
    .trim();

  // `_text` is Postgres's own name for `text[]`; `text[]` is what
  // `declaredColumns` marks an `isArray` column with. Same type, two spellings.
  const element = cleaned.startsWith('_')
    ? cleaned.slice(1)
    : cleaned.endsWith('[]')
      ? cleaned.slice(0, -2).trim()
      : null;

  if (element != null && element.length > 0) {
    return `${TYPE_FAMILIES.get(element) ?? element}[]`;
  }

  return TYPE_FAMILIES.get(cleaned) ?? cleaned;
}

// ---------------------------------------------------------------------------
// The two sides, reduced to plain data
// ---------------------------------------------------------------------------

/** One entity column, reduced to the three facts worth comparing. */
export interface DeclaredColumn {
  /** `ColumnMetadata.databaseName` — the name TypeORM will actually put in SQL. */
  name: string;
  nullable: boolean;
  /** Driver-normalized type string, folded through {@link typeFamily} when compared. */
  type: string;
}

/** One `information_schema.columns` row, narrowed the same way. */
export interface DdlColumn {
  nullable: boolean;
  /** `udt_name` — `timestamptz`, `int4`, `jsonb`. */
  type: string;
}

/** The live shape of one table. */
export interface DdlTable {
  columns: Map<string, DdlColumn>;
  /** PK columns in constraint order, which is the index's column order. */
  primaryKey: string[];
}

/** Two same-keyed records, for a jest diff that reads as "entity vs database". */
export interface Comparison {
  entity: Record<string, unknown>;
  database: Record<string, unknown>;
}

/**
 * Properties the entity declares that the migration never created.
 *
 * Every column of an entity appears in the SELECT list TypeORM generates, so one
 * bad property breaks every READ of the table, not just the writes that touch
 * it.
 */
export function columnsWithNoDdl(declared: readonly DeclaredColumn[], live: DdlTable): string[] {
  return declared.filter((column) => !live.columns.has(column.name)).map((column) => column.name);
}

/**
 * Columns the migration created that no property maps.
 *
 * The direction nobody remembers to check, and the one that actually happens: an
 * unmapped column is omitted from every INSERT and UPDATE the repository builds,
 * so its value reverts to the column default on every save. That is data loss
 * with a green test suite, which is why it is a failure and not a warning.
 */
export function columnsWithNoProperty(declared: readonly DeclaredColumn[], live: DdlTable): string[] {
  const names = new Set(declared.map((column) => column.name));

  return [...live.columns.keys()].filter((name) => !names.has(name));
}

/**
 * Columns both sides know about.
 *
 * Comparisons are restricted to these on purpose: a name mismatch is already
 * reported by the two functions above, and letting it fail the nullability and
 * type checks as well would bury the real message under two derived ones.
 */
export function shared(declared: readonly DeclaredColumn[], live: DdlTable): DeclaredColumn[] {
  return declared.filter((column) => live.columns.has(column.name));
}

/** Nullability, entity vs database, over the shared columns. */
export function compareNullability(declared: readonly DeclaredColumn[], live: DdlTable): Comparison {
  const columns = shared(declared, live);

  return {
    entity: Object.fromEntries(columns.map((column) => [column.name, column.nullable])),
    database: Object.fromEntries(
      columns.map((column) => [column.name, live.columns.get(column.name)!.nullable]),
    ),
  };
}

/** Type FAMILIES, entity vs database, over the shared columns. */
export function compareTypeFamilies(declared: readonly DeclaredColumn[], live: DdlTable): Comparison {
  const columns = shared(declared, live);

  return {
    entity: Object.fromEntries(columns.map((column) => [column.name, typeFamily(column.type)])),
    database: Object.fromEntries(
      columns.map((column) => [column.name, typeFamily(live.columns.get(column.name)!.type)]),
    ),
  };
}

// ---------------------------------------------------------------------------
// Reading the two sides
// ---------------------------------------------------------------------------

/**
 * An entity's columns as plain data.
 *
 * The type comes from the DRIVER's normalization rather than the raw string in
 * the decorator, so what is compared is the type TypeORM believes the column
 * has — the same answer it would use to build DDL.
 */
export function declaredColumns(dataSource: DataSource, metadata: EntityMetadata): DeclaredColumn[] {
  return metadata.columns.map((column) => ({
    name: column.databaseName,
    nullable: column.isNullable,
    // `normalizeType` answers with the ELEMENT type for an array column —
    // array-ness lives in `isArray` — so it is re-attached here. Without this an
    // entity that lost `array: true` would still compare equal to its `_text`
    // column, and TypeORM would write scalars into an array.
    type: column.isArray
      ? `${dataSource.driver.normalizeType(column)}[]`
      : dataSource.driver.normalizeType(column),
  }));
}

/**
 * Read `information_schema` once for a whole schema's worth of tables.
 *
 * A reachable database MISSING one of the tables throws, with the migrate
 * command in the message. That split is deliberate and matches the harness:
 * "nothing is listening" is an absent database and must skip, whereas "something
 * is listening but the schema is wrong" is a broken setup and must fail loudly —
 * skipping there would turn a migration mistake into a green run.
 */
export async function introspectTables(
  dataSource: DataSource,
  schema: string,
  tables: readonly string[],
): Promise<Map<string, DdlTable>> {
  const columns = await dataSource.query<
    Array<{ table_name: string; column_name: string; is_nullable: string; udt_name: string }>
  >(
    `SELECT table_name, column_name, is_nullable, udt_name
       FROM information_schema.columns
      WHERE table_schema = $1
        AND table_name = ANY($2::text[])
      ORDER BY table_name, ordinal_position`,
    [schema, tables],
  );

  const primaryKeys = await dataSource.query<Array<{ table_name: string; column_name: string }>>(
    // `key_column_usage.ordinal_position` is the column's position WITHIN the
    // constraint — i.e. the PK index's column order, which is the thing worth
    // asserting.
    `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = ANY($2::text[])
      ORDER BY tc.table_name, kcu.ordinal_position`,
    [schema, tables],
  );

  const ddl = new Map<string, DdlTable>();

  for (const table of tables) {
    const own = columns.filter((row) => row.table_name === table);

    if (own.length === 0) {
      throw new Error(
        `${schema}.${table} is missing from this database. Run ` +
          '`yarn workspace @ci/be-api migrate` and try again.',
      );
    }

    ddl.set(table, {
      columns: new Map(
        own.map((row): [string, DdlColumn] => [
          row.column_name,
          { nullable: row.is_nullable === 'YES', type: row.udt_name },
        ]),
      ),
      primaryKey: primaryKeys.filter((row) => row.table_name === table).map((row) => row.column_name),
    });
  }

  return ddl;
}
