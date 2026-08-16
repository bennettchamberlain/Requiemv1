import { StagedUploadPurgeCron, STAGED_UPLOAD_PURGE_CRON } from '../StagedUploadPurgeCron';

/**
 * The schedule that keeps the uploads directory honest. Without it, nothing
 * reclaims an abandoned upload OR the crash-window orphans, and multi-GB
 * archives pile up forever.
 */

function build() {
  const sources = {
    purgeExpired: jest.fn(async () => 2),
    sweepUploadOrphans: jest.fn(async () => 1),
  };
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  };
  const cron = new StagedUploadPurgeCron(sources as never, logger as never);

  return { cron, sources, logger };
}

describe('StagedUploadPurgeCron', () => {
  it('runs hourly', () => {
    expect(STAGED_UPLOAD_PURGE_CRON).toBe('0 17 * * * *');
  });

  it('runs both sweeps and reports how many it reclaimed', async () => {
    const { cron, sources } = build();

    expect(await cron.purgeOnce()).toBe(3);
    expect(sources.purgeExpired).toHaveBeenCalled();
    expect(sources.sweepUploadOrphans).toHaveBeenCalled();
  });

  it('swallows a failing sweep — a crashed cron exits the process, a missed sweep costs an hour', async () => {
    const { cron, sources, logger } = build();

    sources.purgeExpired.mockRejectedValueOnce(new Error('database is down'));

    await expect(cron.runOnSchedule()).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
