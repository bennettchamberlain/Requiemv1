import type { RequestContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { AnomalyEngine, CorrelationEngine, SuggestionEngine } from '@ci/domains/daily-metrics';

import { AnomaliesRecentTool } from '../AnomaliesRecentTool';
import { InsightsExplainTool } from '../InsightsExplainTool';
import { SuggestionsFeedbackTool } from '../SuggestionsFeedbackTool';
import { SuggestionsListTool } from '../SuggestionsListTool';

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

describe('derivation tools', () => {
  it('insights.explain uses still-learning copy when there is no overlapping history', async () => {
    const tool = new InsightsExplainTool(
      { list: jest.fn().mockResolvedValue([]) } as unknown as CorrelationEngine,
      logger(),
    );

    const result = await tool.execute(CONTEXT, { metricA: 'km_traveled' });

    expect(result.success).toBe(true);
    expect(result.data?.found).toBe(false);
    expect(result.data?.text).toContain('Still learning your patterns for km_traveled');
    expect(result.data?.text.toLowerCase()).not.toContain('you usually');
    expect(result.data?.text.toLowerCase()).not.toContain('cause');
  });

  it('insights.explain narrates a robust association as a hypothesis', async () => {
    const tool = new InsightsExplainTool(
      {
        list: jest.fn().mockResolvedValue([
          {
            metricA: 'km_traveled',
            metricB: 'avg_sentiment',
            lagDays: 1,
            n: 40,
            effect: 0.42,
            qValue: 0.03,
            robust: true,
          },
        ]),
      } as unknown as CorrelationEngine,
      logger(),
    );

    const result = await tool.execute(CONTEXT, { metricA: 'km_traveled' });

    expect(result.data?.found).toBe(true);
    expect(result.data?.text).toContain('associated with');
    expect(result.data?.text.toLowerCase()).not.toMatch(/\bcauses\b/);
    expect(result.data?.n).toBe(40);
  });

  it('anomalies.recent does not return legacy summary rows', async () => {
    const tool = new AnomaliesRecentTool(
      {
        list: jest.fn().mockResolvedValue([
          {
            id: 'a1',
            metric: 'n_conversations',
            date: '2026-08-16',
            detector: 'robust_z',
            direction: 'low',
            score: 3.7,
          },
        ]),
      } as unknown as AnomalyEngine,
      logger(),
    );

    const result = await tool.execute(CONTEXT, {});

    expect(result.data?.items).toHaveLength(1);
    expect(result.data?.items[0].id).toBe('a1');
    expect(result.data?.text.toLowerCase()).not.toContain('you usually');
  });

  it('anomalies.recent uses still-learning copy when empty', async () => {
    const tool = new AnomaliesRecentTool(
      { list: jest.fn().mockResolvedValue([]) } as unknown as AnomalyEngine,
      logger(),
    );

    const result = await tool.execute(CONTEXT, { metric: 'n_places' });

    expect(result.data?.items).toEqual([]);
    expect(result.data?.text).toContain('Still learning your patterns for n_places');
  });

  it('suggestions.list is empty without evidence-linked rows', async () => {
    const tool = new SuggestionsListTool(
      { list: jest.fn().mockResolvedValue([]) } as unknown as SuggestionEngine,
      logger(),
    );

    const result = await tool.execute(CONTEXT, {});

    expect(result.data?.items).toEqual([]);
    expect(result.data?.text).toContain('Still learning your patterns');
  });

  it('suggestions.feedback writes accept/dismiss through the engine', async () => {
    const feedback = jest.fn().mockResolvedValue({ id: 'sug-1' });
    const tool = new SuggestionsFeedbackTool(
      { feedback } as unknown as SuggestionEngine,
      logger(),
    );

    const result = await tool.execute(CONTEXT, { id: 'sug-1', accepted: false });

    expect(feedback).toHaveBeenCalledWith(expect.objectContaining({ userId: CONTEXT.userId }), 'sug-1', false);
    expect(result.data?.ok).toBe(true);
    expect(result.data?.text).toContain('dismissed');
  });
});
