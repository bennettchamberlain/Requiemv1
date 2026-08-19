import type { UserServiceContext } from '@ci/common/context';
import type { PlaceTransitionService } from '@ci/domains/daily-metrics';
import type { UserService } from '@ci/domains/user';

import { PlaceForecastService } from './PlaceForecastService';

const CONTEXT: UserServiceContext = { userId: '00000000-0000-0000-0000-0000000000aa' };
const AT = new Date('2026-07-08T09:00:00Z');

const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

function makeMocks() {
  const placeTransitionService = {
    predictNext: jest.fn(),
    rebuild: jest.fn(),
  };
  const userService = {
    findById: jest.fn(async () => ({ timezone: 'America/New_York' })),
  };
  const service = new PlaceForecastService(
    placeTransitionService as unknown as PlaceTransitionService,
    userService as unknown as UserService,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger as any,
  );

  return { service, placeTransitionService, userService };
}

describe('PlaceForecastService.predictNext', () => {
  it('maps transition-model output onto the Forecast item shape', async () => {
    const { service, placeTransitionService } = makeMocks();
    placeTransitionService.predictNext.mockResolvedValueOnce({
      status: 'OK',
      predictedAt: AT,
      horizonHours: 4,
      k: 5,
      backoffLevel: 'FROM_HOUR_DOW',
      predictions: [
        {
          clusterId: 'office',
          label: 'Office',
          lat: 40.02,
          lng: -73.0,
          probability: 0.75,
          visitCount: 12,
          lastSeen: AT,
        },
      ],
      heatGrid: [],
    });

    await expect(service.predictNext(CONTEXT, 5, 4)).resolves.toEqual([
      {
        clusterId: 'office',
        lat: 40.02,
        lng: -73.0,
        visits: 12,
        share: 0.75,
        lastSeen: AT.toISOString(),
        label: 'Office',
        probability: 0.75,
        backoffLevel: 'FROM_HOUR_DOW',
      },
    ]);
    expect(placeTransitionService.rebuild).not.toHaveBeenCalled();
  });

  it('rebuilds once when the user has no clusters yet', async () => {
    const { service, placeTransitionService } = makeMocks();
    placeTransitionService.predictNext
      .mockResolvedValueOnce({
        status: 'NO_HISTORY',
        predictedAt: AT,
        horizonHours: 4,
        k: 5,
        backoffLevel: null,
        predictions: [],
        heatGrid: [],
      })
      .mockResolvedValueOnce({
        status: 'OK',
        predictedAt: AT,
        horizonHours: 4,
        k: 5,
        backoffLevel: 'GLOBAL_PRIOR',
        predictions: [
          {
            clusterId: 'home',
            label: null,
            lat: 40.0,
            lng: -73.0,
            probability: 1,
            visitCount: 3,
            lastSeen: null,
          },
        ],
        heatGrid: [],
      });
    placeTransitionService.rebuild.mockResolvedValueOnce({ clusters: 1, transitions: 0 });

    const items = await service.predictNext(CONTEXT);

    expect(placeTransitionService.rebuild).toHaveBeenCalledTimes(1);
    expect(items).toHaveLength(1);
    expect(items[0].backoffLevel).toBe('GLOBAL_PRIOR');
    expect(items[0].share).toBe(1);

    placeTransitionService.predictNext.mockResolvedValueOnce({
      status: 'NO_HISTORY',
      predictedAt: AT,
      horizonHours: 4,
      k: 5,
      backoffLevel: null,
      predictions: [],
      heatGrid: [],
    });

    await service.predictNext(CONTEXT);
    expect(placeTransitionService.rebuild).toHaveBeenCalledTimes(1);
  });
});
