import type { LoggerService } from '@ci/common/logging';

import type { DailyMetricsService } from '../../services/DailyMetricsService';
import type { DerivationScanService } from '../../services/DerivationScanService';
import { DailyMetricsCron } from '../DailyMetricsCron';

function makeCron() {
  const pendingResolvers: Array<() => void> = [];
  const refreshAll = jest.fn().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        pendingResolvers.push(resolve);
      }),
  );
  const scanAll = jest.fn().mockResolvedValue(undefined);
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const cron = new DailyMetricsCron(
    { refreshAll } as unknown as DailyMetricsService,
    { scanAll } as unknown as DerivationScanService,
    logger as unknown as LoggerService,
  );

  return { cron, refreshAll, scanAll, logger, finishRefresh: () => pendingResolvers.shift()?.() };
}

describe('DailyMetricsCron.refreshRecent', () => {
  it('skips a tick while the previous refresh is still running', async () => {
    const { cron, refreshAll, logger, finishRefresh } = makeCron();

    const first = cron.refreshRecent();
    await cron.refreshRecent();

    expect(refreshAll).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();

    finishRefresh();
    await first;

    const second = cron.refreshRecent();
    finishRefresh();
    await second;

    expect(refreshAll).toHaveBeenCalledTimes(2);
  });

  it('releases the overlap guard when a refresh fails', async () => {
    const refreshAll = jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const scanAll = jest.fn().mockResolvedValue(undefined);
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const cron = new DailyMetricsCron(
      { refreshAll } as unknown as DailyMetricsService,
      { scanAll } as unknown as DerivationScanService,
      logger as unknown as LoggerService,
    );

    await cron.refreshRecent();

    expect(logger.error).toHaveBeenCalled();
    expect(scanAll).toHaveBeenCalledTimes(1);

    await cron.refreshRecent();

    expect(refreshAll).toHaveBeenCalledTimes(2);
  });

  it('runs the derivation scan after metrics refresh', async () => {
    const { cron, scanAll, finishRefresh } = makeCron();

    const run = cron.refreshRecent();
    finishRefresh();
    await run;

    expect(scanAll).toHaveBeenCalledTimes(1);
  });
});
