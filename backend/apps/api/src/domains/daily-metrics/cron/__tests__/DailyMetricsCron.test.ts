import type { LoggerService } from '@ci/common/logging';
import type { UserService } from '@ci/domains/user';

import type { PlaceTransitionService } from '../../places/PlaceTransitionService';
import type { DailyMetricsService } from '../../services/DailyMetricsService';
import { DailyMetricsCron } from '../DailyMetricsCron';

function placeDeps() {
  return {
    placeTransitionService: {
      rebuild: jest.fn().mockResolvedValue({ clusters: 0, transitions: 0 }),
      scoreLog: jest.fn().mockResolvedValue({}),
    } as unknown as PlaceTransitionService,
    userService: {
      findAll: jest.fn().mockResolvedValue([]),
    } as unknown as UserService,
  };
}

function makeCron() {
  const pendingResolvers: Array<() => void> = [];
  const refreshAll = jest.fn().mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        pendingResolvers.push(resolve);
      }),
  );
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const { placeTransitionService, userService } = placeDeps();

  const cron = new DailyMetricsCron(
    { refreshAll } as unknown as DailyMetricsService,
    placeTransitionService,
    userService,
    logger as unknown as LoggerService,
  );

  return { cron, refreshAll, logger, finishRefresh: () => pendingResolvers.shift()?.() };
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
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const { placeTransitionService, userService } = placeDeps();
    const cron = new DailyMetricsCron(
      { refreshAll } as unknown as DailyMetricsService,
      placeTransitionService,
      userService,
      logger as unknown as LoggerService,
    );

    await cron.refreshRecent();

    expect(logger.error).toHaveBeenCalled();

    await cron.refreshRecent();

    expect(refreshAll).toHaveBeenCalledTimes(2);
  });

  it('rebuilds and scores the place engine after metrics refresh', async () => {
    const refreshAll = jest.fn().mockResolvedValue(undefined);
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const rebuild = jest.fn().mockResolvedValue({ clusters: 2, transitions: 3 });
    const scoreLog = jest.fn().mockResolvedValue({});
    const cron = new DailyMetricsCron(
      { refreshAll } as unknown as DailyMetricsService,
      { rebuild, scoreLog } as unknown as PlaceTransitionService,
      {
        findAll: jest.fn().mockResolvedValue([{ id: 'user-1', timezone: 'America/New_York' }]),
      } as unknown as UserService,
      logger as unknown as LoggerService,
    );

    await cron.refreshRecent();

    expect(rebuild).toHaveBeenCalledWith({ userId: 'user-1' }, { timezone: 'America/New_York' });
    expect(scoreLog).toHaveBeenCalledWith({ userId: 'user-1' });
  });
});
