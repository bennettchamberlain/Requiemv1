import type { RequestContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { PlaceForecastService } from '@ci/domains/predictions';

import { PlacesNextTool } from '../PlacesNextTool';

const CONTEXT = { userId: '00000000-0000-0000-0000-0000000000aa' } as RequestContext;

function logger(): LoggerService {
  return {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;
}

describe('PlacesNextTool', () => {
  it('returns still-learning copy when there is no stay history', async () => {
    const tool = new PlacesNextTool(
      { predictNext: jest.fn().mockResolvedValue([]) } as unknown as PlaceForecastService,
      logger(),
    );

    const result = await tool.execute(CONTEXT, {});

    expect(result.success).toBe(true);
    expect(result.data?.found).toBe(false);
    expect(result.data?.places).toEqual([]);
    expect(result.data?.text).toContain('Still learning your patterns for places');
    expect(result.data?.text.toLowerCase()).not.toContain('you usually go');
  });

  it('returns ranked places in the same shape as GraphQL placeForecast', async () => {
    const places = [
      {
        clusterId: 'c1',
        lat: 37.7,
        lng: -122.4,
        visits: 12,
        share: 0.61,
        lastSeen: '2026-08-16T18:00:00.000Z',
        label: 'Home',
        probability: 0.61,
        backoffLevel: 'cluster',
      },
    ];
    const tool = new PlacesNextTool(
      { predictNext: jest.fn().mockResolvedValue(places) } as unknown as PlaceForecastService,
      logger(),
    );

    const result = await tool.execute(CONTEXT, { k: 3, horizonHours: 8 });

    expect(result.data?.found).toBe(true);
    expect(result.data?.places).toEqual(places);
    expect(result.data?.text).toContain('Home');
    expect(result.data?.text.toLowerCase()).not.toContain('you usually go');
    expect(result.data?.k).toBe(3);
    expect(result.data?.horizonHours).toBe(8);
  });
});
