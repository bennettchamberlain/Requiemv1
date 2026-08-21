import type { FeatureService } from '@ci/common/feature';
import type { ClientFactory, Connection } from '@ci/domains/connections';
import { EventListenerRegistry } from '@ci/domains/events';

import { ConnectionSyncJobExecuteEvent, ConnectionSyncJobTransformEvent } from '../../events';
import { ConnectionSyncJobService } from '../../services/ConnectionSyncJobService';
import type { EndpointServiceMap } from '../../services/EndpointServiceMap';
import type { ConnectionSyncJob } from '../../types';
import { SyncOrchestrator } from '../SyncOrchestrator';

const HOUR_MS = 60 * 60 * 1000;

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    userId: 'user-1',
    active: true,
    activeEndpoints: ['messages'],
    refreshToken: null,
    tokenExpiry: null,
    syncState: {},
    provider: {
      id: 'provider-1',
      name: 'signal',
      endpoints: [{ name: 'messages', iterationType: 'incremental', TTL: undefined }],
    },
    ...overrides,
  } as unknown as Connection;
}

function makeSyncJob(overrides: Partial<ConnectionSyncJob> = {}): ConnectionSyncJob {
  return {
    id: 'job-1',
    userId: 'user-1',
    connectionId: 'conn-1',
    endpointName: 'messages',
    status: 'pending',
    type: 'incremental',
    data: {},
    cursor: {},
    nextCursor: {},
    lastTransformed: null,
    updatedAt: new Date(),
    completedAt: null,
    ...overrides,
  } as unknown as ConnectionSyncJob;
}

/**
 * The REAL {@link ConnectionSyncJobService} claim methods, over a `manager.query`
 * that answers the two claim UPDATEs the way Postgres does: the WHERE is
 * evaluated and the row mutated in one uninterrupted step (nothing awaits
 * inside), and the result is TypeORM's UPDATE shape — the pair
 * `[rows, rowCount]`, NOT the RETURNING rows.
 *
 * Both of those matter. The atomicity is what a real row lock gives two racing
 * UPDATEs, and is what makes "exactly one winner" a meaningful assertion. The
 * shape is what the previous version of these tests could not see: they replaced
 * `claimPending`/`claimTransform` with hand-written mocks implementing the
 * INTENDED semantics, so they exercised the mock and stayed green while the
 * service itself read `[[], 0]` as two rows and let every caller win.
 */
function claimingSyncJobService(
  row: { status: string; lastTransformed: Date | null; transformClaimedAt: Date | null } = {
    status: 'pending',
    lastTransformed: null,
    transformClaimedAt: null,
  },
) {
  const managerQuery = jest.fn(async (sql: string, params: unknown[]) => {
    const isPendingClaim = sql.includes("SET status = 'in_progress'");
    const matched = isPendingClaim
      ? row.status === 'pending'
      : row.lastTransformed == null &&
        (row.transformClaimedAt == null || row.transformClaimedAt.getTime() < Date.now() - HOUR_MS);

    if (!matched) {
      return [[], 0];
    }

    if (isPendingClaim) {
      row.status = 'in_progress';
    } else {
      row.transformClaimedAt = new Date();
    }

    return [[{ id: params[0] as string }], 1];
  });

  const logger = { setContext() {}, log() {}, warn() {}, error() {} };
  const service = new ConnectionSyncJobService(
    { manager: { query: managerQuery } } as never,
    logger as never,
  );

  return { service, row, managerQuery };
}

function buildOrchestrator(
  overrides: {
    connectionService?: Record<string, jest.Mock>;
    connectionSyncJobService?: Record<string, jest.Mock>;
    eventService?: Record<string, jest.Mock>;
    endpointServiceMap?: Record<string, jest.Mock>;
    clientFactory?: Record<string, jest.Mock>;
    syncFeatureEnabled?: boolean;
  } = {},
) {
  const connectionService = {
    findActiveConnections: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(makeConnection()),
    update: jest.fn().mockImplementation(async (_ctx, _id, patch) => ({ ...makeConnection(), ...patch })),
    ...overrides.connectionService,
  };

  const connectionSyncJobService = {
    search: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue(makeSyncJob()),
    findById: jest.fn().mockResolvedValue(makeSyncJob()),
    update: jest.fn().mockResolvedValue(makeSyncJob()),
    markAsCompleted: jest.fn().mockResolvedValue(makeSyncJob({ status: 'failed' })),
    claimPending: jest.fn().mockResolvedValue(true),
    claimTransform: jest.fn().mockResolvedValue(true),
    ...overrides.connectionSyncJobService,
  };

  const eventService = {
    send: jest.fn().mockResolvedValue(['job-id']),
    ...overrides.eventService,
  };

  const endpointServiceMap = {
    getSyncFunction: jest.fn(),
    getTransformFunction: jest.fn(),
    ...overrides.endpointServiceMap,
  };

  const clientFactory = {
    getClientByProviderId: jest.fn().mockReturnValue({ refreshAccessToken: jest.fn() }),
    ...overrides.clientFactory,
  };

  const featureService = {
    isFeatureEnabled: jest
      .fn()
      .mockImplementation(
        async (key: string) => key === 'scheduled.connection.sync' && overrides.syncFeatureEnabled !== false,
      ),
  };

  const logger = { setContext() {}, log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  const orchestrator = new SyncOrchestrator(
    connectionService as never,
    connectionSyncJobService as unknown as ConnectionSyncJobService,
    eventService as never,
    endpointServiceMap as unknown as EndpointServiceMap,
    clientFactory as unknown as ClientFactory,
    featureService as unknown as FeatureService,
    logger as never,
  );

  return {
    orchestrator,
    connectionService,
    connectionSyncJobService,
    eventService,
    endpointServiceMap,
    clientFactory,
    featureService,
    logger,
  };
}

describe('SyncOrchestrator.executeSyncJobs — concurrency + per-connection dedup', () => {
  it('runs at most one pending job per connection, even with multiple pending jobs on the same connection', async () => {
    const { orchestrator, eventService, connectionSyncJobService } = buildOrchestrator({
      connectionSyncJobService: {
        search: jest.fn().mockImplementation(async (_ctx, filter: { status: string }) => {
          if (filter.status === 'pending') {
            return [
              makeSyncJob({ id: 'job-a1', connectionId: 'conn-a' }),
              makeSyncJob({ id: 'job-a2', connectionId: 'conn-a' }),
            ];
          }

          return [];
        }),
      },
    });

    await orchestrator.executeSyncJobs();

    expect(connectionSyncJobService.search).toHaveBeenCalled();
    expect(eventService.send).toHaveBeenCalledTimes(1);
    expect(eventService.send).toHaveBeenCalledWith(
      ConnectionSyncJobExecuteEvent,
      { connectionSyncJobId: 'job-a1' },
      { singletonKey: 'job-a1' },
    );
  });

  it('does not start a new job on a connection that already has one in progress', async () => {
    const { orchestrator, eventService } = buildOrchestrator({
      connectionSyncJobService: {
        search: jest.fn().mockImplementation(async (_ctx, filter: { status: string }) => {
          if (filter.status === 'in_progress') {
            return [makeSyncJob({ id: 'job-busy', connectionId: 'conn-busy', status: 'in_progress' })];
          }

          if (filter.status === 'pending') {
            return [makeSyncJob({ id: 'job-new', connectionId: 'conn-busy' })];
          }

          return [];
        }),
      },
    });

    await orchestrator.executeSyncJobs();

    expect(eventService.send).not.toHaveBeenCalled();
  });

  it('caps total in-flight jobs at 5, counting in-progress jobs toward the cap', async () => {
    const inProgress = Array.from({ length: 4 }, (_, i) =>
      makeSyncJob({ id: `busy-${i}`, connectionId: `busy-conn-${i}`, status: 'in_progress' }),
    );
    const pending = Array.from({ length: 4 }, (_, i) =>
      makeSyncJob({ id: `pending-${i}`, connectionId: `pending-conn-${i}` }),
    );

    const { orchestrator, eventService } = buildOrchestrator({
      connectionSyncJobService: {
        search: jest.fn().mockImplementation(async (_ctx, filter: { status: string }) => {
          return filter.status === 'in_progress' ? inProgress : pending;
        }),
      },
    });

    await orchestrator.executeSyncJobs();

    // 4 already in progress + only 1 more pending job admitted = 5 total.
    expect(eventService.send).toHaveBeenCalledTimes(1);
  });

  it('dispatches nothing when there are no pending jobs', async () => {
    const { orchestrator, eventService } = buildOrchestrator();

    await orchestrator.executeSyncJobs();

    expect(eventService.send).not.toHaveBeenCalled();
  });
});

describe('SyncOrchestrator.handleSyncJobExecuteEvent — claim check and lifecycle', () => {
  it('logs and returns when the sync job cannot be found', async () => {
    const { orchestrator, connectionSyncJobService, logger } = buildOrchestrator({
      connectionSyncJobService: { findById: jest.fn().mockResolvedValue(null) },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'missing' });

    expect(logger.error).toHaveBeenCalled();
    expect(connectionSyncJobService.update).not.toHaveBeenCalled();
  });

  it('skips a job whose claim is lost — the redelivery/duplicate-tick claim check', async () => {
    const { orchestrator, connectionSyncJobService, connectionService } = buildOrchestrator({
      connectionSyncJobService: {
        findById: jest.fn().mockResolvedValue(makeSyncJob({ status: 'in_progress' })),
        claimPending: jest.fn().mockResolvedValue(false),
      },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' });

    expect(connectionSyncJobService.claimPending).toHaveBeenCalledWith(expect.anything(), 'job-1');
    expect(connectionSyncJobService.update).not.toHaveBeenCalled();
    expect(connectionService.findById).not.toHaveBeenCalled();
  });

  it('marks the job failed when its connection no longer exists', async () => {
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: { findById: jest.fn().mockResolvedValue(null) },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' });

    expect(connectionSyncJobService.claimPending).toHaveBeenCalledWith(expect.anything(), 'job-1');
    expect(connectionSyncJobService.markAsCompleted).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      'failed',
      expect.objectContaining({ error: 'Connection not found' }),
    );
  });

  it('marks the job failed when the connection has no provider', async () => {
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: { findById: jest.fn().mockResolvedValue(makeConnection({ provider: undefined })) },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' });

    expect(connectionSyncJobService.markAsCompleted).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      'failed',
      expect.objectContaining({ error: 'Provider not found for connection' }),
    );
  });

  it('marks the job failed when no sync function is registered for the provider/endpoint', async () => {
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      endpointServiceMap: { getSyncFunction: jest.fn().mockReturnValue(undefined) },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' });

    expect(connectionSyncJobService.markAsCompleted).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      'failed',
      expect.objectContaining({ error: 'No service function found for provider and endpoint' }),
    );
  });

  it('refreshes an expired access token before syncing and strips a null refreshToken from the update', async () => {
    const refreshAccessToken = jest.fn().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: null,
      tokenExpiry: new Date(Date.now() + HOUR_MS),
    });
    const serviceFunction = jest.fn().mockResolvedValue({ data: {}, nextCursor: {} });
    const expiredConnection = makeConnection({
      refreshToken: 'old-refresh-token',
      tokenExpiry: new Date(Date.now() - 1000),
    } as never);

    const { orchestrator, connectionService } = buildOrchestrator({
      connectionService: { findById: jest.fn().mockResolvedValue(expiredConnection) },
      endpointServiceMap: { getSyncFunction: jest.fn().mockReturnValue(serviceFunction) },
      clientFactory: { getClientByProviderId: jest.fn().mockReturnValue({ refreshAccessToken }) },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' });

    expect(refreshAccessToken).toHaveBeenCalledWith(expiredConnection);
    const updateCall = connectionService.update.mock.calls.find(
      (call: unknown[]) => !('syncState' in (call[2] as Record<string, unknown>)),
    );
    expect(updateCall?.[2]).not.toHaveProperty('refreshToken');
    expect(updateCall?.[2]).toMatchObject({ accessToken: 'new-access-token' });
  });

  it('does not refresh the token when it has not expired', async () => {
    const refreshAccessToken = jest.fn();
    const serviceFunction = jest.fn().mockResolvedValue({ data: {}, nextCursor: {} });
    const freshConnection = makeConnection({
      refreshToken: 'refresh-token',
      tokenExpiry: new Date(Date.now() + HOUR_MS),
    } as never);

    const { orchestrator } = buildOrchestrator({
      connectionService: { findById: jest.fn().mockResolvedValue(freshConnection) },
      endpointServiceMap: { getSyncFunction: jest.fn().mockReturnValue(serviceFunction) },
      clientFactory: { getClientByProviderId: jest.fn().mockReturnValue({ refreshAccessToken }) },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' });

    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('on success, records the result on the job and merges lastSyncedAt into the existing syncState', async () => {
    const serviceFunction = jest.fn().mockResolvedValue({ data: { messages: 3 }, nextCursor: { page: 2 } });
    const connectionWithState = makeConnection({ syncState: { someExistingKey: 'keep-me' } } as never);

    const { orchestrator, connectionSyncJobService, connectionService } = buildOrchestrator({
      connectionService: { findById: jest.fn().mockResolvedValue(connectionWithState) },
      endpointServiceMap: { getSyncFunction: jest.fn().mockReturnValue(serviceFunction) },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' });

    expect(connectionSyncJobService.update).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      expect.objectContaining({ data: { messages: 3 }, nextCursor: { page: 2 }, status: 'success' }),
    );

    const syncStateUpdateCall = connectionService.update.mock.calls.find((call: unknown[]) =>
      Object.prototype.hasOwnProperty.call(call[2] as Record<string, unknown>, 'syncState'),
    );
    expect(syncStateUpdateCall?.[2]).toMatchObject({
      syncState: expect.objectContaining({ someExistingKey: 'keep-me', lastSyncedAt: expect.any(String) }),
    });
  });

  it('marks the job failed (without throwing) when the sync function itself throws, persisting a readable message', async () => {
    const serviceFunction = jest.fn().mockRejectedValue(new Error('provider rate limited'));

    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      endpointServiceMap: { getSyncFunction: jest.fn().mockReturnValue(serviceFunction) },
    });

    await expect(
      orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' }),
    ).resolves.not.toThrow();

    // The bug: passing the raw `Error` object into a jsonb column persists as
    // `{}` — `Error` has no own enumerable properties, so `JSON.stringify`
    // (and every jsonb write path) drops `message` and `stack` entirely.
    // Asserting the exact string (not `expect.any(Error)`) is what catches a
    // regression back to that.
    expect(connectionSyncJobService.markAsCompleted).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      'failed',
      { error: 'provider rate limited' },
    );
  });
});

describe('SyncOrchestrator.handleSyncJobExecuteEvent — concurrent-duplicate races', () => {
  it('runs the sync exactly once when the same job is delivered twice concurrently', async () => {
    const { service } = claimingSyncJobService();
    const claimPending = jest.fn((ctx: never, id: string) => service.claimPending(ctx, id));
    const serviceFunction = jest.fn().mockResolvedValue({ data: {}, nextCursor: {} });

    const { orchestrator } = buildOrchestrator({
      connectionSyncJobService: { claimPending },
      endpointServiceMap: { getSyncFunction: jest.fn().mockReturnValue(serviceFunction) },
    });

    await Promise.all([
      orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' }),
      orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' }),
    ]);

    expect(claimPending).toHaveBeenCalledTimes(2);
    expect(serviceFunction).toHaveBeenCalledTimes(1);
  });

  it('does not re-run a redelivered job that already reached a terminal status', async () => {
    // The defensive `if (syncJob.status !== 'pending') return;` this handler used
    // to carry was deleted in favour of the claim, so the claim is now the ONLY
    // thing standing between a pg-boss redelivery of a finished job and a second
    // provider fetch + ingest of the same data.
    const { service, row } = claimingSyncJobService({
      status: 'success',
      lastTransformed: null,
      transformClaimedAt: null,
    });
    const serviceFunction = jest.fn().mockResolvedValue({ data: {}, nextCursor: {} });

    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionSyncJobService: {
        claimPending: jest.fn((ctx: never, id: string) => service.claimPending(ctx, id)),
        findById: jest.fn().mockResolvedValue(makeSyncJob({ status: 'success' })),
      },
      endpointServiceMap: { getSyncFunction: jest.fn().mockReturnValue(serviceFunction) },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' });

    expect(serviceFunction).not.toHaveBeenCalled();
    expect(connectionSyncJobService.update).not.toHaveBeenCalled();
    expect(row.status).toBe('success');
  });
});

describe('SyncOrchestrator.executeTransformJobs', () => {
  it('dispatches at most 2 transform jobs even when more are eligible', async () => {
    const { orchestrator, eventService } = buildOrchestrator({
      connectionSyncJobService: {
        search: jest
          .fn()
          .mockResolvedValue([
            makeSyncJob({ id: 'j1' }),
            makeSyncJob({ id: 'j2' }),
            makeSyncJob({ id: 'j3' }),
          ]),
      },
    });

    await orchestrator.executeTransformJobs();

    expect(eventService.send).toHaveBeenCalledTimes(2);
    expect(eventService.send).toHaveBeenNthCalledWith(
      1,
      ConnectionSyncJobTransformEvent,
      { connectionSyncJobId: 'j1' },
      { singletonKey: 'j1' },
    );
    expect(eventService.send).toHaveBeenNthCalledWith(
      2,
      ConnectionSyncJobTransformEvent,
      { connectionSyncJobId: 'j2' },
      { singletonKey: 'j2' },
    );
  });

  it('dispatches nothing when there is nothing to transform', async () => {
    const { orchestrator, eventService } = buildOrchestrator();

    await orchestrator.executeTransformJobs();

    expect(eventService.send).not.toHaveBeenCalled();
  });
});

describe('SyncOrchestrator.handleSyncJobTransformEvent — claim check and lifecycle', () => {
  it('returns when the sync job cannot be found', async () => {
    const { orchestrator, logger } = buildOrchestrator({
      connectionSyncJobService: { findById: jest.fn().mockResolvedValue(null) },
    });

    await orchestrator.handleSyncJobTransformEvent({ connectionSyncJobId: 'missing' });

    expect(logger.error).toHaveBeenCalled();
  });

  it('skips a job that is already claimed or transformed — the self-DoS-prevention claim check', async () => {
    const { orchestrator, connectionSyncJobService, connectionService } = buildOrchestrator({
      connectionSyncJobService: {
        findById: jest.fn().mockResolvedValue(makeSyncJob({ lastTransformed: new Date() })),
        claimTransform: jest.fn().mockResolvedValue(false),
      },
    });

    await orchestrator.handleSyncJobTransformEvent({ connectionSyncJobId: 'job-1' });

    expect(connectionSyncJobService.claimTransform).toHaveBeenCalledWith(expect.anything(), 'job-1');
    expect(connectionService.findById).not.toHaveBeenCalled();
    expect(connectionSyncJobService.update).not.toHaveBeenCalled();
  });

  it('returns without updating when the connection cannot be found', async () => {
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: { findById: jest.fn().mockResolvedValue(null) },
    });

    await orchestrator.handleSyncJobTransformEvent({ connectionSyncJobId: 'job-1' });

    expect(connectionSyncJobService.update).not.toHaveBeenCalled();
  });

  it('logs and returns (without updating) when no transform function is registered', async () => {
    const { orchestrator, connectionSyncJobService, logger } = buildOrchestrator({
      endpointServiceMap: { getTransformFunction: jest.fn().mockReturnValue(undefined) },
    });

    await orchestrator.handleSyncJobTransformEvent({ connectionSyncJobId: 'job-1' });

    expect(logger.error).toHaveBeenCalled();
    expect(connectionSyncJobService.update).not.toHaveBeenCalled();
  });

  it('marks lastTransformed on success', async () => {
    const transformFn = jest.fn().mockResolvedValue(undefined);
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      endpointServiceMap: { getTransformFunction: jest.fn().mockReturnValue(transformFn) },
    });

    await orchestrator.handleSyncJobTransformEvent({ connectionSyncJobId: 'job-1' });

    expect(transformFn).toHaveBeenCalled();
    expect(connectionSyncJobService.update).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      expect.objectContaining({ lastTransformed: expect.any(Date) }),
    );
  });

  it('still marks lastTransformed (with the error recorded) when the transform throws — so it does not requeue forever', async () => {
    const transformFn = jest.fn().mockRejectedValue(new Error('OOM during transform'));
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      endpointServiceMap: { getTransformFunction: jest.fn().mockReturnValue(transformFn) },
    });

    await expect(
      orchestrator.handleSyncJobTransformEvent({ connectionSyncJobId: 'job-1' }),
    ).resolves.not.toThrow();

    expect(connectionSyncJobService.update).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      expect.objectContaining({
        lastTransformed: expect.any(Date),
        error: expect.objectContaining({ transformError: 'OOM during transform' }),
      }),
    );
  });
});

describe('SyncOrchestrator.handleSyncJobTransformEvent — concurrent-duplicate races', () => {
  it('runs the transform exactly once when the same job is delivered twice concurrently', async () => {
    // The production bug the claim closes: `lastTransformed` is only written on
    // COMPLETION, so a transform still in flight when the next tick fired was
    // re-enqueued and re-run alongside itself — observed as six concurrent
    // copies of GmailTransformService.transformGmail.
    const { service } = claimingSyncJobService();
    const claimTransform = jest.fn((ctx: never, id: string) => service.claimTransform(ctx, id));
    const transformFn = jest.fn().mockResolvedValue(undefined);

    const { orchestrator } = buildOrchestrator({
      connectionSyncJobService: { claimTransform },
      endpointServiceMap: { getTransformFunction: jest.fn().mockReturnValue(transformFn) },
    });

    await Promise.all([
      orchestrator.handleSyncJobTransformEvent({ connectionSyncJobId: 'job-1' }),
      orchestrator.handleSyncJobTransformEvent({ connectionSyncJobId: 'job-1' }),
    ]);

    expect(claimTransform).toHaveBeenCalledTimes(2);
    expect(transformFn).toHaveBeenCalledTimes(1);
  });

  it('does not re-run a transform for a job already transformed', async () => {
    // `if (syncJob.lastTransformed != null) return;` was deleted in favour of the
    // claim, so `last_transformed IS NULL` in the claim's WHERE is now the only
    // guard against a redelivery re-transforming finished data.
    const { service } = claimingSyncJobService({
      status: 'success',
      lastTransformed: new Date(),
      transformClaimedAt: null,
    });
    const transformFn = jest.fn().mockResolvedValue(undefined);

    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionSyncJobService: {
        claimTransform: jest.fn((ctx: never, id: string) => service.claimTransform(ctx, id)),
        findById: jest
          .fn()
          .mockResolvedValue(makeSyncJob({ status: 'success', lastTransformed: new Date() })),
      },
      endpointServiceMap: { getTransformFunction: jest.fn().mockReturnValue(transformFn) },
    });

    await orchestrator.handleSyncJobTransformEvent({ connectionSyncJobId: 'job-1' });

    expect(transformFn).not.toHaveBeenCalled();
    expect(connectionSyncJobService.update).not.toHaveBeenCalled();
  });
});

describe('SyncOrchestrator.orchestrateSyncJobs', () => {
  function activeConnection(overrides: Partial<Connection> = {}) {
    return { connection: makeConnection(overrides), lastSyncedAt: null };
  }

  it('logs and continues past an endpoint the provider no longer declares', async () => {
    const connection = makeConnection({ activeEndpoints: ['ghost-endpoint'] });
    const { orchestrator, connectionSyncJobService, logger } = buildOrchestrator({
      connectionService: {
        findActiveConnections: jest.fn().mockResolvedValue([{ connection, lastSyncedAt: null }]),
      },
    });

    await expect(orchestrator.orchestrateSyncJobs()).resolves.not.toThrow();

    expect(logger.error).toHaveBeenCalledWith('Active endpoint not found on provider', expect.anything());
    expect(connectionSyncJobService.create).not.toHaveBeenCalled();
  });

  it('creates the first incremental sync job when none exists yet', async () => {
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: { findActiveConnections: jest.fn().mockResolvedValue([activeConnection()]) },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(connectionSyncJobService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'incremental', status: 'pending' }),
    );
  });

  it('does not create a duplicate incremental job while one is already pending', async () => {
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: { findActiveConnections: jest.fn().mockResolvedValue([activeConnection()]) },
      connectionSyncJobService: {
        search: jest.fn().mockResolvedValue([makeSyncJob({ status: 'pending' })]),
      },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(connectionSyncJobService.create).not.toHaveBeenCalled();
  });

  it('marks a stalled (> 1hr) in-progress incremental job failed and enqueues a fresh one', async () => {
    const stalledUpdatedAt = new Date(Date.now() - HOUR_MS - 60_000);
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: { findActiveConnections: jest.fn().mockResolvedValue([activeConnection()]) },
      connectionSyncJobService: {
        search: jest
          .fn()
          .mockResolvedValue([
            makeSyncJob({ id: 'stalled-job', status: 'in_progress', updatedAt: stalledUpdatedAt }),
          ]),
      },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(connectionSyncJobService.markAsCompleted).toHaveBeenCalledWith(
      expect.anything(),
      'stalled-job',
      'failed',
      expect.objectContaining({ error: 'Sync job stalled in progress' }),
    );
  });

  it("starts a new incremental job carrying forward the previous success's nextCursor", async () => {
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: { findActiveConnections: jest.fn().mockResolvedValue([activeConnection()]) },
      connectionSyncJobService: {
        search: jest.fn().mockResolvedValue([makeSyncJob({ status: 'success', nextCursor: { page: 9 } })]),
      },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(connectionSyncJobService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'incremental', cursor: { page: 9 }, status: 'pending' }),
    );
  });

  it('creates the first historical sync job when none exists yet', async () => {
    const connection = makeConnection({
      provider: {
        id: 'provider-1',
        name: 'signal',
        endpoints: [{ name: 'messages', iterationType: 'historical' }],
      } as never,
    });
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: {
        findActiveConnections: jest.fn().mockResolvedValue([{ connection, lastSyncedAt: null }]),
      },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(connectionSyncJobService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'historical', status: 'pending' }),
    );
  });

  it('does not create a new historical job while one is pending or in progress', async () => {
    const connection = makeConnection({
      provider: {
        id: 'provider-1',
        name: 'signal',
        endpoints: [{ name: 'messages', iterationType: 'historical' }],
      } as never,
    });
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: {
        findActiveConnections: jest.fn().mockResolvedValue([{ connection, lastSyncedAt: null }]),
      },
      connectionSyncJobService: {
        search: jest.fn().mockResolvedValue([makeSyncJob({ type: 'historical', status: 'pending' })]),
      },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(connectionSyncJobService.create).not.toHaveBeenCalled();
  });

  it('starts a new historical job when the previous success left a nextCursor (more pages to fetch)', async () => {
    const connection = makeConnection({
      provider: {
        id: 'provider-1',
        name: 'signal',
        endpoints: [{ name: 'messages', iterationType: 'historical' }],
      } as never,
    });
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: {
        findActiveConnections: jest.fn().mockResolvedValue([{ connection, lastSyncedAt: null }]),
      },
      connectionSyncJobService: {
        search: jest.fn().mockResolvedValue([
          makeSyncJob({
            type: 'historical',
            status: 'success',
            nextCursor: { page: 2 },
            completedAt: new Date(),
          }),
        ]),
      },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(connectionSyncJobService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'historical', cursor: { page: 2 } }),
    );
  });

  it('re-triggers a completed historical sync once its TTL has elapsed', async () => {
    const connection = makeConnection({
      provider: {
        id: 'provider-1',
        name: 'signal',
        endpoints: [{ name: 'messages', iterationType: 'historical', TTL: 60 }], // 60s TTL
      } as never,
    });
    const longAgo = new Date(Date.now() - 120_000); // 120s ago > 60s TTL
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: {
        findActiveConnections: jest.fn().mockResolvedValue([{ connection, lastSyncedAt: null }]),
      },
      connectionSyncJobService: {
        search: jest
          .fn()
          .mockResolvedValue([
            makeSyncJob({ type: 'historical', status: 'success', nextCursor: {}, completedAt: longAgo }),
          ]),
      },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(connectionSyncJobService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'historical', status: 'pending' }),
    );
  });

  it('does NOT re-trigger a completed historical sync before its TTL has elapsed', async () => {
    const connection = makeConnection({
      provider: {
        id: 'provider-1',
        name: 'signal',
        endpoints: [{ name: 'messages', iterationType: 'historical', TTL: 3600 }], // 1hr TTL
      } as never,
    });
    const justNow = new Date(Date.now() - 1000); // 1s ago, well under TTL
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: {
        findActiveConnections: jest.fn().mockResolvedValue([{ connection, lastSyncedAt: null }]),
      },
      connectionSyncJobService: {
        search: jest
          .fn()
          .mockResolvedValue([
            makeSyncJob({ type: 'historical', status: 'success', nextCursor: {}, completedAt: justNow }),
          ]),
      },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(connectionSyncJobService.create).not.toHaveBeenCalled();
  });

  it('processes every remaining connection even when one earlier in the sweep has a missing-endpoint error', async () => {
    const badConnection = makeConnection({ id: 'bad-conn', activeEndpoints: ['ghost'] });
    const goodConnection = makeConnection({ id: 'good-conn' });

    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: {
        findActiveConnections: jest.fn().mockResolvedValue([
          { connection: badConnection, lastSyncedAt: null },
          { connection: goodConnection, lastSyncedAt: null },
        ]),
      },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(connectionSyncJobService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ connectionId: 'good-conn' }),
    );
  });
});

describe('SyncOrchestrator — scheduled.connection.sync', () => {
  it('creates no sync job when the feature is off, even with an active connection due for one', async () => {
    const { orchestrator, connectionSyncJobService, featureService } = buildOrchestrator({
      syncFeatureEnabled: false,
      connectionService: {
        findActiveConnections: jest
          .fn()
          .mockResolvedValue([{ connection: makeConnection(), lastSyncedAt: null }]),
      },
    });

    await orchestrator.orchestrateSyncJobs();

    expect(featureService.isFeatureEnabled).toHaveBeenCalledWith('scheduled.connection.sync');
    expect(connectionSyncJobService.create).not.toHaveBeenCalled();
  });

  it('enqueues no execute event when the feature is off, even with a job already pending', async () => {
    const { orchestrator, eventService } = buildOrchestrator({
      syncFeatureEnabled: false,
      connectionSyncJobService: {
        search: jest
          .fn()
          .mockImplementation(async (_ctx, filter: { status: string }) =>
            filter.status === 'pending' ? [makeSyncJob({ id: 'job-pending' })] : [],
          ),
      },
    });

    await orchestrator.executeSyncJobs();

    expect(eventService.send).not.toHaveBeenCalled();
  });

  it('enqueues no transform event when the feature is off, even with untransformed jobs waiting', async () => {
    const { orchestrator, eventService } = buildOrchestrator({
      syncFeatureEnabled: false,
      connectionSyncJobService: {
        search: jest.fn().mockResolvedValue([makeSyncJob({ id: 'j1' }), makeSyncJob({ id: 'j2' })]),
      },
    });

    await orchestrator.executeTransformJobs();

    expect(eventService.send).not.toHaveBeenCalled();
  });
});

/**
 * The de-duplication ImportStageListener's own dedicated test
 * (importStageListenerRole.test.ts) pins: asserting a mocked `events.send`
 * carries a `singletonKey` can never observe whether the QUEUE enforces it —
 * pg-boss 10 makes de-duplication a queue property (its unique index on
 * (name, singleton_key) is partial, `WHERE state='created' AND
 * policy='short'`), and under the default `standard` policy a singletonKey is
 * stored but never enforced. This asserts the queue DECLARATION itself.
 */
describe("SyncOrchestrator's 'etl' queue policy", () => {
  it("declares policy 'short' on the shared etl queue, so singletonKey bites", () => {
    expect(EventListenerRegistry.getQueueOptions('etl')?.policy).toBe('short');
  });
});
