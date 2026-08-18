import type { ClientFactory, Connection } from '@ci/domains/connections';

import { ConnectionSyncJobExecuteEvent, ConnectionSyncJobTransformEvent } from '../../events';
import type { ConnectionSyncJobService } from '../../services/ConnectionSyncJobService';
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

function buildOrchestrator(
  overrides: {
    connectionService?: Record<string, jest.Mock>;
    connectionSyncJobService?: Record<string, jest.Mock>;
    eventService?: Record<string, jest.Mock>;
    endpointServiceMap?: Record<string, jest.Mock>;
    clientFactory?: Record<string, jest.Mock>;
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

  const logger = { setContext() {}, log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

  const orchestrator = new SyncOrchestrator(
    connectionService as never,
    connectionSyncJobService as unknown as ConnectionSyncJobService,
    eventService as never,
    endpointServiceMap as unknown as EndpointServiceMap,
    clientFactory as unknown as ClientFactory,
    logger as never,
  );

  return {
    orchestrator,
    connectionService,
    connectionSyncJobService,
    eventService,
    endpointServiceMap,
    clientFactory,
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
    expect(eventService.send).toHaveBeenCalledWith(ConnectionSyncJobExecuteEvent, {
      connectionSyncJobId: 'job-a1',
    });
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

  it('skips a job that is no longer pending — the redelivery/duplicate-tick claim check', async () => {
    const { orchestrator, connectionSyncJobService, connectionService } = buildOrchestrator({
      connectionSyncJobService: {
        findById: jest.fn().mockResolvedValue(makeSyncJob({ status: 'in_progress' })),
      },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' });

    expect(connectionSyncJobService.update).not.toHaveBeenCalled();
    expect(connectionService.findById).not.toHaveBeenCalled();
  });

  it('marks the job failed when its connection no longer exists', async () => {
    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      connectionService: { findById: jest.fn().mockResolvedValue(null) },
    });

    await orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' });

    expect(connectionSyncJobService.update).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      expect.objectContaining({ status: 'in_progress' }),
    );
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

  it('marks the job failed (without throwing) when the sync function itself throws', async () => {
    const serviceFunction = jest.fn().mockRejectedValue(new Error('provider rate limited'));

    const { orchestrator, connectionSyncJobService } = buildOrchestrator({
      endpointServiceMap: { getSyncFunction: jest.fn().mockReturnValue(serviceFunction) },
    });

    await expect(
      orchestrator.handleSyncJobExecuteEvent({ connectionSyncJobId: 'job-1' }),
    ).resolves.not.toThrow();

    expect(connectionSyncJobService.markAsCompleted).toHaveBeenCalledWith(
      expect.anything(),
      'job-1',
      'failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
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
    expect(eventService.send).toHaveBeenNthCalledWith(1, ConnectionSyncJobTransformEvent, {
      connectionSyncJobId: 'j1',
    });
    expect(eventService.send).toHaveBeenNthCalledWith(2, ConnectionSyncJobTransformEvent, {
      connectionSyncJobId: 'j2',
    });
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

  it('skips a job that was already transformed — the self-DoS-prevention claim check', async () => {
    const { orchestrator, connectionSyncJobService, connectionService } = buildOrchestrator({
      connectionSyncJobService: {
        findById: jest.fn().mockResolvedValue(makeSyncJob({ lastTransformed: new Date() })),
      },
    });

    await orchestrator.handleSyncJobTransformEvent({ connectionSyncJobId: 'job-1' });

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
        search: jest
          .fn()
          .mockResolvedValue([
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
