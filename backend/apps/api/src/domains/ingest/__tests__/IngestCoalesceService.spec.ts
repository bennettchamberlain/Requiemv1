import { COALESCE_STAGES } from '../owedStages';
import {
  IngestCoalesceService,
  INGEST_COALESCE_DELAY_SECONDS,
  INGEST_COALESCE_QUEUE,
} from '../services/IngestCoalesceService';

function makeService(opts: { selfHeal?: boolean; running?: boolean } = {}) {
  const eventService = { send: jest.fn(async () => ['job-1']) };
  const featureService = {
    isFeatureEnabled: jest.fn(async () => opts.selfHeal !== false),
  };
  const orchestrator = {
    isRunning: jest.fn(() => opts.running === true),
    orchestrate: jest.fn(async () => ({ ok: true, legs: [], totalDurationMs: 1 })),
  };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const service = new IngestCoalesceService(
    eventService as never,
    featureService as never,
    orchestrator as never,
    logger as never,
  );

  return { service, eventService, featureService, orchestrator };
}

describe('IngestCoalesceService', () => {
  const userId = '00000000-0000-0000-0000-0000000000aa';

  it('does not enqueue when ingest.selfHeal is off', async () => {
    const { service, eventService, featureService } = makeService({ selfHeal: false });

    await service.schedule(userId);

    expect(featureService.isFeatureEnabled).toHaveBeenCalledWith('ingest.selfHeal');
    expect(eventService.send).not.toHaveBeenCalled();
  });

  it('enqueues a delayed singleton keyed by user', async () => {
    const { service, eventService } = makeService();

    await service.schedule(userId);

    expect(eventService.send).toHaveBeenCalledWith(
      'ingest.coalesce',
      { userId },
      {
        queue: INGEST_COALESCE_QUEUE,
        singletonKey: userId,
        startAfter: INGEST_COALESCE_DELAY_SECONDS,
      },
    );
  });

  it('reschedules when the orchestrator is already running', async () => {
    const { service, eventService, orchestrator } = makeService({ running: true });

    await service.run({ userId });

    expect(orchestrator.orchestrate).not.toHaveBeenCalled();
    expect(eventService.send).toHaveBeenCalledWith(
      'ingest.coalesce',
      { userId },
      expect.objectContaining({ singletonKey: userId, startAfter: INGEST_COALESCE_DELAY_SECONDS }),
    );
  });

  it('orchestrates the union of owed stages when idle', async () => {
    const { service, orchestrator } = makeService();

    await service.run({ userId });

    expect(orchestrator.orchestrate).toHaveBeenCalledWith(userId, { stages: [...COALESCE_STAGES] });
  });
});
