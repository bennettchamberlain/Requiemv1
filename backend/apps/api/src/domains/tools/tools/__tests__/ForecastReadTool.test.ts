import type { RequestContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { ForecastResponse, HbpeService } from '@ci/domains/predictions';

import { summarizeForecast, ForecastReadTool } from '../ForecastReadTool';

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

describe('summarizeForecast', () => {
  it('picks the dominant L0 and L1 per bucket', () => {
    const out = summarizeForecast({
      horizon: '24h',
      generated_at: '2026-08-17T00:00:00Z',
      system_status: 'READY',
      buckets: [
        {
          bucket_index: 30,
          start_time: '2026-08-17T15:00:00Z',
          l0_probs: { WORK: 0.72, LEISURE: 0.2 },
          l1_probs: { 'Deep Focus': 0.65, Meeting: 0.1 },
          l2_probs: null,
          q10: 0,
          q50: 0,
          q90: 0,
        },
      ],
    });

    expect(out.bucketCount).toBe(1);
    expect(out.buckets[0].dominantL0).toEqual({ label: 'WORK', probability: 0.72 });
    expect(out.buckets[0].topL1).toEqual({ label: 'Deep Focus', probability: 0.65 });
  });
});

const RESPONSE: ForecastResponse = {
  horizon: '24h',
  generated_at: '2026-08-17T00:00:00Z',
  system_status: 'READY',
  buckets: [
    {
      bucket_index: 0,
      start_time: '2026-08-17T00:00:00Z',
      l0_probs: { SLEEP: 0.9 },
      l1_probs: { Asleep: 0.9 },
      l2_probs: null,
      q10: 0,
      q50: 0,
      q90: 0,
    },
  ],
};

describe('ForecastReadTool', () => {
  it('passes the requested horizon through to HbpeService and summarizes the response', async () => {
    const getForecast = jest.fn().mockResolvedValue(RESPONSE);
    const tool = new ForecastReadTool({ getForecast } as unknown as HbpeService, logger());

    const result = await tool.execute(CONTEXT, { horizon: '24h' });

    expect(getForecast).toHaveBeenCalledWith({ userId: CONTEXT.userId }, '24h');
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      horizon: '24h',
      systemStatus: 'READY',
      bucketCount: 1,
    });
    expect(result.data?.buckets[0].dominantL0).toEqual({ label: 'SLEEP', probability: 0.9 });
  });

  it('defaults horizon to 24h when omitted from input', async () => {
    const getForecast = jest.fn().mockResolvedValue(RESPONSE);
    const tool = new ForecastReadTool({ getForecast } as unknown as HbpeService, logger());

    await tool.execute(CONTEXT, {});

    expect(getForecast).toHaveBeenCalledWith({ userId: CONTEXT.userId }, '24h');
  });

  it('turns an HbpeService failure into a failed tool result via BaseTool error handling', async () => {
    const getForecast = jest.fn().mockRejectedValue(new Error('hbpe unavailable'));
    const tool = new ForecastReadTool({ getForecast } as unknown as HbpeService, logger());

    const result = await tool.execute(CONTEXT, {});

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('hbpe unavailable');
  });
});
