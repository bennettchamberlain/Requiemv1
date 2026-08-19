import type { StageRunContext } from '../../types';
import { UnpackStage } from '../UnpackStage';

/**
 * The early-refusal branch: `UnpackStage.run()` checks database free space
 * BEFORE acquiring or extracting anything, and throws `DatabaseVolumeFullError`
 * rather than let 40GB move onto disk only for the push to ENOSPC later. The
 * same guard on `PushStage` is integration-tested (`pushStage.integration.spec.ts`);
 * this copy had none — both integration specs that otherwise drive
 * `UnpackStage` (`inboxTenancy`, `stagedSourceSpine`) only exercise the
 * acquire()/move path, never this one.
 *
 * `readDatabaseSpace` itself (the statfs probe) is mocked at the module
 * boundary — its own correctness is a filesystem/Postgres concern, not this
 * stage's. What is under test here is purely UnpackStage's OWN gate: does it
 * read the result and refuse before touching the claimed source, and does it
 * leave a merely-unknown reading alone.
 */

jest.mock('../../storage/databaseSpace', () => {
  const actual = jest.requireActual('../../storage/databaseSpace');

  return { ...actual, readDatabaseSpace: jest.fn() };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const databaseSpaceMock = require('../../storage/databaseSpace') as {
  readDatabaseSpace: jest.Mock;
  DatabaseVolumeFullError: new (...args: never[]) => Error;
  DATABASE_FREE_FLOOR_BYTES: number;
};
const { readDatabaseSpace, DatabaseVolumeFullError, DATABASE_FREE_FLOOR_BYTES } = databaseSpaceMock;

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

function buildStage() {
  const dataSource = { query: jest.fn() };
  const stagedSources = { findByRunId: jest.fn(async () => null) };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), debug: jest.fn() };

  return {
    stage: new UnpackStage(dataSource as never, stagedSources as never, logger as never),
    stagedSources,
  };
}

function contextFor(): StageRunContext {
  return {
    runId: RUN_ID,
    userId: USER_ID,
    stageId: '33333333-3333-4333-8333-333333333333',
    scratchDir: '/var/tmp/ci-import/test-run',
    progress: jest.fn(async () => undefined),
  };
}

beforeEach(() => {
  readDatabaseSpace.mockReset();
});

describe('UnpackStage.run — database-space preflight', () => {
  it('refuses to unpack, and never touches the claimed source, when the volume is below the floor', async () => {
    readDatabaseSpace.mockResolvedValue({
      databaseBytes: 500 * 1024 ** 3,
      freeBytes: DATABASE_FREE_FLOOR_BYTES - 1,
      dataDir: '/var/lib/postgresql/data',
    });

    const { stage, stagedSources } = buildStage();

    await expect(stage.run(contextFor())).rejects.toBeInstanceOf(DatabaseVolumeFullError);

    // The whole point: refused BEFORE any acquire/move touched the source.
    expect(stagedSources.findByRunId).not.toHaveBeenCalled();
  });

  it('proceeds past the gate once free space clears the floor', async () => {
    readDatabaseSpace.mockResolvedValue({
      databaseBytes: 500 * 1024 ** 3,
      freeBytes: DATABASE_FREE_FLOOR_BYTES + 1,
      dataDir: '/var/lib/postgresql/data',
    });

    const { stage, stagedSources } = buildStage();

    // findByRunId resolving null throws NotFoundException — a DIFFERENT error
    // than the space guard, which is exactly how this proves control reached
    // acquire() rather than the gate refusing unconditionally.
    await expect(stage.run(contextFor())).rejects.not.toBeInstanceOf(DatabaseVolumeFullError);
    expect(stagedSources.findByRunId).toHaveBeenCalledWith(USER_ID, RUN_ID);
  });

  it('does not refuse when free space could not be measured — "cannot say" is not "no space"', async () => {
    readDatabaseSpace.mockResolvedValue({
      databaseBytes: 500 * 1024 ** 3,
      freeBytes: null,
      dataDir: null,
    });

    const { stage, stagedSources } = buildStage();

    await expect(stage.run(contextFor())).rejects.not.toBeInstanceOf(DatabaseVolumeFullError);
    expect(stagedSources.findByRunId).toHaveBeenCalled();
  });
});
