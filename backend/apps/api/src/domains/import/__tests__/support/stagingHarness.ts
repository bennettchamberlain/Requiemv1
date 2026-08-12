import { randomUUID } from 'node:crypto';

import { DataSource } from 'typeorm';

import { EntityIdentifierEntity, NodeEntity, RelationshipEntity } from '@ci/domains/graph';

import { databaseAvailability, resolveConnection } from '../../../__tests__/support/databaseConnection';
import { EntityMappingEntity } from '../../entities/EntityMappingEntity';
import { ImportRunEntity } from '../../entities/ImportRunEntity';
import { ImportStageEntity } from '../../entities/ImportStageEntity';
import { StagedEntityEntity } from '../../entities/StagedEntityEntity';
import { StagedItemEntity } from '../../entities/StagedItemEntity';
import { StagedRelationshipEntity } from '../../entities/StagedRelationshipEntity';
import { StagedSourceEntity } from '../../entities/StagedSourceEntity';
import { ImportRunService, type StartRunResult } from '../../services/ImportRunService';
import { StagedSourceService } from '../../services/StagedSourceService';
import { StagedWriter } from '../../staging/StagedWriter';

/**
 * Shared setup for the specs that write real `ci_import` rows.
 *
 * Every one of them needs the same four things — a DataSource, the schema
 * present, a drop to start a run against, and cleanup that respects the
 * cascade — and a second copy of that boilerplate is a second place for the
 * isolation rules to drift.
 *
 * ## Isolation
 *
 * Each harness mints its own user id, so concurrent suites cannot see each
 * other's rows. Cleanup deletes the runs, which CASCADEs every `staged_*` row
 * by design, then the drops — `staged_sources.run_id` is ON DELETE SET NULL
 * precisely so deleting a run cannot orphan stored bytes, which means the drop
 * rows outlive their runs and have to go explicitly.
 */

/** Suite-specific override so this work can be pointed at a scratch database. */
export const IMPORT_DATABASE_ENV = {
  urlEnvVar: 'IMPORT_TEST_DATABASE_URL',
  probeTimeoutEnvVar: 'IMPORT_TEST_PROBE_TIMEOUT_MS',
};

/** Whether these specs can run at all. Consulted at collection time. */
export const importDatabase = databaseAvailability(IMPORT_DATABASE_ENV);

export interface StagingHarness {
  dataSource: DataSource;
  service: ImportRunService;
  stagedSources: StagedSourceService;
  /** Records what {@link ImportRunService} enqueued, in place of a real queue. */
  events: { send: jest.Mock };
  userId: string;
  /** Stage a drop the way the upload endpoint would, and return its dropId. */
  stageDrop(filename?: string): Promise<string>;
  /** Start a run against a fresh drop and return its id. */
  startRun(filename?: string): Promise<string>;
  /**
   * Start a run against an existing drop, registering it for cleanup.
   *
   * Callers that reach for `service.startRun` directly leak their run past
   * teardown, so anything that needs the full result goes through here.
   */
  startRunForDrop(dropId: string): Promise<StartRunResult>;
  /** A writer scoped to a fresh run. */
  writerFor(dataSourceName: string): Promise<{ writer: StagedWriter; runId: string }>;
}

/**
 * Connect, verify the schema, and hand back the pieces plus a teardown.
 *
 * A reachable database MISSING `ci_import` fails loudly, naming the command that
 * fixes it: a missing migration must never read as a passing test.
 */
export async function createStagingHarness(): Promise<{
  harness: StagingHarness;
  teardown: () => Promise<void>;
}> {
  const connection = resolveConnection(IMPORT_DATABASE_ENV);

  if (connection == null) {
    throw new Error('availability said yes but no connection resolved');
  }

  const dataSource = new DataSource({
    type: 'postgres',
    ...(connection.url != null
      ? { url: connection.url }
      : {
          host: connection.host,
          port: connection.port,
          username: connection.username,
          password: connection.password,
          database: connection.database,
        }),
    entities: [
      // The graph entities are registered so a spec can run a REAL
      // GraphIngestService against this connection. The entity lane's identity
      // rules live in the server, not in the importer, and a mocked stand-in is
      // exactly what hid a handle being written into a uuid column.
      EntityIdentifierEntity,
      NodeEntity,
      RelationshipEntity,
      EntityMappingEntity,
      ImportRunEntity,
      ImportStageEntity,
      StagedEntityEntity,
      StagedItemEntity,
      StagedRelationshipEntity,
      StagedSourceEntity,
    ],
    synchronize: false,
    extra: { options: '-c search_path=ci,public' },
  });

  await dataSource.initialize();

  const [{ present }] = await dataSource.query<Array<{ present: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ci_import') AS present`,
  );

  if (!present) {
    await dataSource.destroy();

    throw new Error(
      'The ci_import schema is missing from this database. Run `yarn workspace @ci/be-api migrate` ' +
        'before this suite — a missing migration must not read as a passing test.',
    );
  }

  const stubLogger = () =>
    ({
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }) as never;

  const events = { send: jest.fn(async () => undefined) };
  // A REAL StagedSourceService over the same connection: the spine specs
  // assert claim/consume/release transitions, and a mock would agree with
  // whatever the spec author believed.
  const stagedSources = new StagedSourceService(dataSource.getRepository(StagedSourceEntity), stubLogger());
  const service = new ImportRunService(dataSource, events as never, stagedSources, stubLogger());

  const userId = randomUUID();
  const createdRuns: string[] = [];
  const createdDrops: string[] = [];

  // A REAL `ci.users` row, not just a uuid.
  //
  // Nothing in `ci_import` references the user, so a bare uuid was enough for as
  // long as these specs stayed inside the staging schema. The push stage leaves
  // it: `ci.entities.owner_user_id` carries a foreign key, and every entity a
  // run resolves fails on it if the owner does not exist.
  await dataSource.query(
    `INSERT INTO ci.users (id, name, email) VALUES ($1::uuid, 'import harness', $2)
     ON CONFLICT (id) DO NOTHING`,
    [userId, `import-harness-${userId}@example.invalid`],
  );

  const stageDrop = async (filename = 'export.zip'): Promise<string> => {
    const dropId = randomUUID();

    // A fabricated source_path is fine here: these specs exercise the claim
    // SQL and the run spine, never the filesystem. Suites that need real
    // bytes (stagedSourceSpine) seed their own tmp uploads dir instead.
    await dataSource.query(
      `INSERT INTO ci_import.staged_sources
         (user_id, origin, drop_id, source_path, kind, original_filename, status, expires_at)
       VALUES ($1::uuid, 'upload', $2, $3, 'file', $4, 'staged', now() + interval '1 day')`,
      [userId, dropId, `/nonexistent/uploads/${dropId}/${filename}`, filename],
    );

    createdDrops.push(dropId);

    return dropId;
  };

  const startRunForDrop = async (dropId: string): Promise<StartRunResult> => {
    const result = await service.startRun({ userId }, { dropId });

    createdRuns.push(result.run.id);

    return result;
  };

  const startRun = async (filename?: string): Promise<string> => {
    const { run } = await startRunForDrop(await stageDrop(filename));

    return run.id;
  };

  const harness: StagingHarness = {
    dataSource,
    service,
    stagedSources,
    events,
    userId,
    stageDrop,
    startRun,
    startRunForDrop,
    writerFor: async (dataSourceName: string) => {
      const runId = await startRun();

      return {
        runId,
        writer: new StagedWriter(dataSource.manager, { userId, runId, dataSource: dataSourceName }),
      };
    },
  };

  const teardown = async (): Promise<void> => {
    if (!dataSource.isInitialized) {
      return;
    }

    for (const runId of createdRuns) {
      await dataSource.query(`DELETE FROM ci_import.import_runs WHERE id = $1::uuid`, [runId]);
    }

    for (const dropId of createdDrops) {
      await dataSource.query(`DELETE FROM ci_import.staged_sources WHERE user_id = $1::uuid AND drop_id = $2`, [
        userId,
        dropId,
      ]);
    }

    // Whatever the push stage resolved into `ci.*` belongs to this harness user
    // alone, so it goes with them. Entities before identifiers and the user
    // last: both reference what precedes them.
    await dataSource.query(
      `DELETE FROM ci.entity_identifiers WHERE owner_user_id = $1::uuid`,
      [userId],
    );
    await dataSource.query(`DELETE FROM ci.entities WHERE owner_user_id = $1::uuid`, [userId]);
    await dataSource.query(`DELETE FROM ci.users WHERE id = $1::uuid`, [userId]);

    await dataSource.destroy();
  };

  return { harness, teardown };
}
