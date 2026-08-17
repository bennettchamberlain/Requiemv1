import { summarizeForecast } from '../ForecastReadTool';

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
