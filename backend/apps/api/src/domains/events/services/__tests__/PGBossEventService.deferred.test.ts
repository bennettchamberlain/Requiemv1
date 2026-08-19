import { EventEmitter2 } from '@nestjs/event-emitter';

import type { LoggerService } from '@ci/common/logging';
import type { Acknowledgement } from '@ci/domains/events';

import { PGBossEventService } from '../PGBossEventService';

const logger = {
  setContext() {},
  log() {},
  warn() {},
  error() {},
  debug() {},
} as unknown as LoggerService;

type Outcome = 'completed' | 'deferred';

/** Drives the private executeJob directly — the work-loop wrapper only adds fetch/complete. */
function runJob(service: PGBossEventService, queue: string, name: string): Promise<Outcome> {
  const job = { id: 'job-1', data: { name } };

  return (service as unknown as { executeJob: (q: string, j: unknown) => Promise<Outcome> }).executeJob(
    queue,
    job,
  );
}

describe('PGBossEventService deferred completion', () => {
  let emitter: EventEmitter2;
  let service: PGBossEventService;

  beforeEach(() => {
    emitter = new EventEmitter2();
    service = new PGBossEventService(emitter, logger, {} as never);
  });

  it('resolves completed when the listener acks done', async () => {
    emitter.on('my.event:my-queue', (_payload, ack: Acknowledgement) => ack.done());

    await expect(runJob(service, 'my-queue', 'my.event')).resolves.toBe('completed');
  });

  it('resolves deferred when the listener defers — the work loop then skips boss.complete', async () => {
    emitter.on('my.event:my-queue', (_payload, ack: Acknowledgement) => ack.defer());

    await expect(runJob(service, 'my-queue', 'my.event')).resolves.toBe('deferred');
  });

  it('rejects when the listener fails, so the work loop boss.fail()s the job', async () => {
    emitter.on('my.event:my-queue', (_payload, ack: Acknowledgement) => ack.fail(new Error('nope')));

    await expect(runJob(service, 'my-queue', 'my.event')).rejects.toThrow('nope');
  });

  it('resolves completed when no listener is registered (skip)', async () => {
    await expect(runJob(service, 'other-queue', 'my.event')).resolves.toBe('completed');
  });

  it('completeJob / failJob delegate to pg-boss by queue and job id', async () => {
    const boss = {
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn().mockResolvedValue(undefined),
    };

    (service as unknown as { boss: typeof boss }).boss = boss;

    await service.completeJob('py-fn-summary', 'job-9', { ok: true });
    expect(boss.complete).toHaveBeenCalledWith('py-fn-summary', 'job-9', { ok: true });

    await service.failJob('py-fn-summary', 'job-9', { message: 'runner died' });
    expect(boss.fail).toHaveBeenCalledWith('py-fn-summary', 'job-9', { message: 'runner died' });
  });
});
