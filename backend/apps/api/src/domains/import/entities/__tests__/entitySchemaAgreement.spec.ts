import { readdirSync } from 'node:fs';
import path from 'node:path';

import { DataSource, type EntityMetadata, type EntityTarget, type ObjectLiteral } from 'typeorm';

import {
  columnsWithNoDdl,
  columnsWithNoProperty,
  compareNullability,
  compareTypeFamilies,
  declaredColumns as declaredColumnsOf,
  introspectTables,
  type DdlTable,
  type DeclaredColumn,
} from '../../../__tests__/support/schemaAgreement';
// The repo's one contract for "may a test touch Postgres?", plus the dotenv load
// that makes DATABASE_* visible to jest. Imported across domains deliberately:
// re-implementing the synchronous probe here is how two suites end up disagreeing
// about whether a database exists. See pipeline/__tests__/harness/README.md.
import { databaseAvailability, resolveConnection } from '../../../pipeline/__tests__/harness/pipelineHarness';
import { EntityMappingEntity } from '../EntityMappingEntity';
import { ImportRunEntity } from '../ImportRunEntity';
import { ImportStageEntity } from '../ImportStageEntity';
import { StagedSourceEntity } from '../StagedSourceEntity';
import { StagedEntityEntity } from '../StagedEntityEntity';
import { StagedItemEntity } from '../StagedItemEntity';
import { StagedRelationshipEntity } from '../StagedRelationshipEntity';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ci_import ENTITIES AGREE WITH THE MIGRATION. VERIFIED AGAINST LIVE DDL.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The same guard `ci`'s control plane has, for the importer's staging schema,
 * and for the same reason: `20260810164304_create_ci_import_schema.sql` is the
 * source of truth, the entities are a hand-maintained copy of it, and nothing
 * else in the build compares the two. `synchronize` is off, so TypeORM never
 * notices; `tsc` never notices, because a drifted entity is still valid
 * TypeScript; and mocked-repository unit tests never notice, because a mock
 * agrees with whatever the entity claims.
 *
 * The exposure is larger here than it looks. PRs 3–5 write these tables through
 * repositories rather than raw SQL, and the failure mode of an unmapped column
 * is not a crash — it is a silent revert to the column default on every save.
 * A `pushStatus` that quietly resets to `'pending'`, or a `runId` that resets to
 * NULL, would turn a resumable import into an infinite one, and every unit test
 * would stay green while it happened.
 *
 * What is compared, what is not, and why the comparisons are pure functions are
 * all documented on `src/domains/__tests__/support/schemaAgreement.ts`. The
 * falsifiability block lives with the pipeline domain's copy of this file, which
 * exercises those same shared functions — so the checks used here are
 * demonstrated to be capable of failing on every CI run, database or not.
 *
 * ── Skipping ───────────────────────────────────────────────────────────────
 *
 * No reachable database SKIPS (CI runs `yarn test` with no Postgres service). A
 * database that IS reachable but missing `ci_import` FAILS, naming the migrate
 * command — a missing migration must never read as a pass.
 */

// ---------------------------------------------------------------------------
// The declaration
// ---------------------------------------------------------------------------

/** One entity and the table `20260810164304_create_ci_import_schema.sql` makes for it. */
interface StagingTable {
  entity: EntityTarget<ObjectLiteral>;
  /** Spelled out here rather than read off the entity: this is the expectation, not the claim. */
  table: string;
}

/**
 * The seven staging tables.
 *
 * Written out by hand so this is an INDEPENDENT statement of what the migration
 * created. A list derived from the entities could only ever agree with them,
 * which would make a renamed `@Entity({ name })` something this file follows
 * rather than catches.
 */
const STAGING: readonly StagingTable[] = [
  { entity: ImportRunEntity, table: 'import_runs' },
  { entity: ImportStageEntity, table: 'import_stages' },
  { entity: StagedItemEntity, table: 'staged_items' },
  { entity: StagedEntityEntity, table: 'staged_entities' },
  { entity: StagedRelationshipEntity, table: 'staged_relationships' },
  { entity: EntityMappingEntity, table: 'entity_mappings' },
  { entity: StagedSourceEntity, table: 'staged_sources' },
];

/**
 * Every staging table lives here. Hardcoded so a stray `schema:` is caught —
 * an entity that silently pointed at `ci` would find real tables to collide
 * with rather than failing cleanly.
 */
const STAGING_SCHEMA = 'ci_import';

// ---------------------------------------------------------------------------
// Suite gating
// ---------------------------------------------------------------------------

const availability = databaseAvailability();

const describeWithDatabase = availability.available ? describe : describe.skip;

if (!availability.available) {
  // Printed once per run so a skipped suite is never mistaken for a passing one.
  console.warn(`[import/entitySchemaAgreement] SKIPPED — ${availability.reason}`);
}

// One connection, one round of introspection.
jest.setTimeout(60_000);

// ---------------------------------------------------------------------------
// The folder guard — no database required
// ---------------------------------------------------------------------------

describe('the ci_import declaration', () => {
  it('pins every entity in this folder', () => {
    // An eighth staged table is exactly the moment this file stops covering the
    // schema, and it is the moment nobody thinks to open it. Reading the
    // directory means the omission fails here instead of surviving until that
    // entity's first repository call.
    //
    // Filtering on `*Entity.ts` matches `application.ts`'s own entity glob, so
    // a helper module beside them (`pushState.ts`) is correctly not a table.
    const onDisk = readdirSync(path.resolve(__dirname, '..'))
      .filter((file) => file.endsWith('Entity.ts'))
      .sort();

    const pinned = STAGING.map((entry) => `${(entry.entity as { name: string }).name}.ts`).sort();

    expect(onDisk).toEqual(pinned);
  });
});

// ---------------------------------------------------------------------------
// The agreement
// ---------------------------------------------------------------------------

describeWithDatabase(`ci_import entity ↔ migration agreement (${availability.target})`, () => {
  let dataSource: DataSource;

  /** The live DDL, keyed by table name. Populated once. */
  let ddl = new Map<string, DdlTable>();

  beforeAll(async () => {
    const connection = resolveConnection();

    if (connection == null) {
      throw new Error(
        'import/entitySchemaAgreement ran with no database configured. The suite is gated on ' +
          'databaseAvailability().available; reaching here means the gate broke.',
      );
    }

    dataSource = new DataSource({
      type: 'postgres',
      // Discrete fields when there is no URL, so a password containing URL
      // metacharacters never has to survive a round trip through
      // percent-encoding.
      ...(connection.url != null
        ? { url: connection.url }
        : {
            host: connection.host,
            port: connection.port,
            username: connection.username,
            password: connection.password,
            database: connection.database,
          }),
      // Loaded for their METADATA, not to query through. `synchronize` must stay
      // false: pointed at the dev database, TypeORM would happily "fix" the
      // drift this file exists to report — by rewriting the source of truth to
      // match the copy.
      entities: [
        ImportRunEntity,
        ImportStageEntity,
        StagedItemEntity,
        StagedEntityEntity,
        StagedRelationshipEntity,
        EntityMappingEntity,
        StagedSourceEntity,
      ],
      synchronize: false,
      logging: false,
      extra: { max: 2 },
    });

    await dataSource.initialize();

    try {
      ddl = await introspectTables(
        dataSource,
        STAGING_SCHEMA,
        STAGING.map((entry) => entry.table),
      );
    } catch (err: unknown) {
      await dataSource.destroy();

      throw err;
    }
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
  });

  /** The live DDL for a table. */
  function live(table: string): DdlTable {
    const found = ddl.get(table);

    if (found == null) {
      throw new Error(`No introspection recorded for ${STAGING_SCHEMA}.${table}.`);
    }

    return found;
  }

  /** The entity's columns as plain data, bound to this suite's driver. */
  function declaredColumns(metadata: EntityMetadata): DeclaredColumn[] {
    return declaredColumnsOf(dataSource, metadata);
  }

  describe.each(STAGING)('$table', ({ entity, table }: StagingTable) => {
    let metadata: EntityMetadata;
    let declared: DeclaredColumn[];

    beforeAll(() => {
      metadata = dataSource.getMetadata(entity);
      declared = declaredColumns(metadata);
    });

    it(`resolves to ${STAGING_SCHEMA}.${table}`, () => {
      // Everything below reads the live DDL for the table NAMED HERE, so if the
      // entity pointed somewhere else the rest of this block would be comparing
      // it against a table it never touches.
      expect({ schema: metadata.schema, table: metadata.tableName }).toEqual({
        schema: STAGING_SCHEMA,
        table,
      });
    });

    it('declares no column the migration did not create', () => {
      expect(columnsWithNoDdl(declared, live(table))).toEqual([]);
    });

    it('maps every column the migration created', () => {
      // The silent direction. An unmapped `push_status` or `run_id` is omitted
      // from every INSERT and UPDATE the repository builds, so it reverts to the
      // column default on each save — which for those two columns means a push
      // that never finishes and staged rows that lose their run.
      expect(columnsWithNoProperty(declared, live(table))).toEqual([]);
    });

    it('agrees with the migration on nullability', () => {
      const comparison = compareNullability(declared, live(table));

      expect(comparison.entity).toEqual(comparison.database);
    });

    it('agrees with the migration on column type families', () => {
      // Families, not strings. `uuid` mapped as `text` still reads, and changes
      // the semantics of every comparison and index lookup; `jsonb` mapped as
      // `text` silently double-encodes every write, which for the parsers'
      // metadata blobs would be discovered a long way downstream.
      const comparison = compareTypeFamilies(declared, live(table));

      expect(comparison.entity).toEqual(comparison.database);
    });

    it('agrees with the migration on the primary key, in order', () => {
      // Ordered, not a set. Six of these tables carry a surrogate `id`, but
      // `entity_mappings` is keyed on `staged_entity_id` — a natural PK chosen so
      // there is no way to record the same mapping twice — and an entity that
      // grew a surrogate id would quietly lose that guarantee.
      expect(metadata.primaryColumns.map((column) => column.databaseName)).toEqual(live(table).primaryKey);
    });
  });
});
