import type { UserServiceContext } from '@ci/common/context';
import type { FeatureService } from '@ci/common/feature';
import type { LoggerService } from '@ci/common/logging';
import type { ActionService } from '@ci/domains/intelligence';

import type { CorrelationEngine } from '../correlation/CorrelationEngine';
import { shiftIso, todayIsoInTimezone } from '../dateUtil';
import type { MetricAnomaly } from '../entities/MetricAnomalyEntity';
import type { DailyMetricsService } from '../services/DailyMetricsService';
import {
  METRIC_KEYS,
  type DailyMetrics,
  type MetricCoverage,
  type MetricKey,
  type MetricValues,
} from '../types';

import { SuggestionEngine } from './SuggestionEngine';

const USER = '00000000-0000-0000-0000-0000000000aa';
const CONTEXT: UserServiceContext = { userId: USER };

function nullMetrics(): MetricValues {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, null])) as MetricValues;
}

function day(date: string, values: Partial<Record<MetricKey, number>>): DailyMetrics {
  const metrics = nullMetrics();
  const coverage = Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as MetricCoverage;
  for (const [key, value] of Object.entries(values) as Array<[MetricKey, number]>) {
    metrics[key] = value;
    coverage[key] = 1;
  }

  return { userId: USER, date, timezone: 'UTC', metrics, coverage, computedAt: new Date() };
}

function memoryRepo() {
  const rows: Array<Record<string, unknown>> = [];

  return {
    rows,
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return (
        rows.find((row) =>
          Object.entries(where).every(([key, value]) => {
            if (value && typeof value === 'object' && '_type' in (value as object)) {
              return row[key] == null;
            }

            return row[key] === value;
          }),
        ) ?? null
      );
    }),
    create: jest.fn((value: Record<string, unknown>) => ({ ...value })),
    save: jest.fn(async (entity: Record<string, unknown>) => {
      const index = rows.findIndex((row) => row.id === entity.id);
      if (index >= 0) {
        rows[index] = entity;
      } else {
        rows.push(entity);
      }

      return entity;
    }),
    update: jest.fn(async ({ id }: { id: string }, patch: Record<string, unknown>) => {
      const row = rows.find((item) => item.id === id);
      if (row) {
        Object.assign(row, patch);
      }
    }),
    createQueryBuilder: jest.fn(),
  };
}

function logger(): LoggerService {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;
}

function quietConversationRows(yesterday: string, from: string, to: string): DailyMetrics[] {
  const rows: DailyMetrics[] = [];
  let date = from;
  while (date <= to) {
    rows.push(
      day(date, {
        n_conversations: date === yesterday ? 2 : 10,
        n_places: date === yesterday ? 1 : 4,
      }),
    );
    date = shiftIso(date, 1);
  }

  return rows;
}

describe('SuggestionEngine.propose', () => {
  it('does not emit without a correlation or anomaly evidence FK', async () => {
    const yesterday = shiftIso(todayIsoInTimezone('UTC'), -1);
    const suggestions = memoryRepo();
    const engine = new SuggestionEngine(
      suggestions as never,
      memoryRepo() as never,
      {
        getRange: jest.fn(async (_context: UserServiceContext, from: string, to: string) =>
          quietConversationRows(yesterday, from, to),
        ),
      } as unknown as DailyMetricsService,
      { list: jest.fn().mockResolvedValue([]) } as unknown as CorrelationEngine,
      { create: jest.fn() } as unknown as ActionService,
      { isFeatureEnabled: jest.fn().mockResolvedValue(true) } as unknown as FeatureService,
      logger(),
    );

    const persisted = await engine.propose(CONTEXT, [], 'UTC');

    expect(persisted).toHaveLength(0);
  });

  it('persists with evidence when the flag is off and does not create a Brief action', async () => {
    const yesterday = shiftIso(todayIsoInTimezone('UTC'), -1);
    const suggestions = memoryRepo();
    const create = jest.fn();
    const engine = new SuggestionEngine(
      suggestions as never,
      memoryRepo() as never,
      {
        getRange: jest.fn(async (_context: UserServiceContext, from: string, to: string) =>
          quietConversationRows(yesterday, from, to),
        ),
      } as unknown as DailyMetricsService,
      {
        list: jest.fn().mockResolvedValue([
          { id: 'corr-1', metricA: 'n_conversations', metricB: 'avg_sentiment', robust: true },
        ]),
      } as unknown as CorrelationEngine,
      { create } as unknown as ActionService,
      { isFeatureEnabled: jest.fn().mockResolvedValue(false) } as unknown as FeatureService,
      logger(),
    );

    const persisted = await engine.propose(CONTEXT, [], 'UTC');

    expect(persisted.length).toBeGreaterThan(0);
    expect(persisted.every((row) => row.correlationId === 'corr-1' || row.anomalyId)).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('promotes at most one live suggestion action when the flag is on', async () => {
    const yesterday = shiftIso(todayIsoInTimezone('UTC'), -1);
    const suggestions = memoryRepo();
    const create = jest.fn().mockResolvedValue({ id: 'action-1' });
    const anomalies: MetricAnomaly[] = [
      {
        id: 'anom-1',
        userId: USER,
        metric: 'n_places',
        date: yesterday,
        detector: 'robust_z',
        value: 1,
        baseline: 4,
        score: 3.6,
        direction: 'low',
        coverage: 1,
        metadata: {},
        actionId: null,
        computedAt: new Date(),
      },
    ];
    const engine = new SuggestionEngine(
      suggestions as never,
      memoryRepo() as never,
      {
        getRange: jest.fn(async (_context: UserServiceContext, from: string, to: string) =>
          quietConversationRows(yesterday, from, to),
        ),
      } as unknown as DailyMetricsService,
      {
        list: jest.fn().mockResolvedValue([
          { id: 'corr-1', metricA: 'n_conversations', metricB: 'avg_sentiment', robust: true },
        ]),
      } as unknown as CorrelationEngine,
      { create } as unknown as ActionService,
      { isFeatureEnabled: jest.fn().mockResolvedValue(true) } as unknown as FeatureService,
      logger(),
    );

    const persisted = await engine.propose(CONTEXT, anomalies, 'UTC');

    expect(persisted.length).toBeGreaterThan(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1].source).toBe('suggestion');
  });
});
