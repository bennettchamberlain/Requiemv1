/* eslint-disable @typescript-eslint/no-explicit-any */
import type { RequestContext } from '@ci/common/context';
import type { ForecastResponse, PredictionScoreRow } from '@ci/domains/predictions';

import { INTENT_DOMAINS, isIntentDomain } from '../../catalog/domains';
import { intentToolName } from '../../core/types';
import { InsightsListTool } from '../InsightsListTool';
import {
  CALIBRATION_TOOL_BASIS,
  PredictionsCalibrationTool,
  calibrationQualityStatement,
} from '../PredictionsCalibrationTool';
import { PredictionsForecastTool, summarizeForecast } from '../PredictionsForecastTool';

const USER_ID = '00000000-0000-0000-0000-0000000000aa';
const context = { userId: USER_ID } as RequestContext;

function makeLogger(): any {
  return {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

function makeScoreRow(overrides: Partial<PredictionScoreRow> = {}): PredictionScoreRow {
  return {
    scored_at: new Date('2026-07-14T05:00:00.000Z'),
    window_start: new Date('2026-06-30T05:00:00.000Z'),
    window_end: new Date('2026-07-14T05:00:00.000Z'),
    brier: 0.42,
    l0_top1_acc: 0.75,
    l1_top3_acc: 0.5,
    ece: 0.08,
    coverage: 0.96,
    reliability_json: [],
    drift_flag: false,
    n_buckets: 120,
    ...overrides,
  };
}

function makeForecastResponse(): ForecastResponse {
  return {
    horizon: '24h',
    generated_at: '2026-07-15T12:00:00Z',
    system_status: 'READY',
    buckets: [
      {
        bucket_index: 0,
        start_time: '2026-07-16T00:00:00Z',
        l0_probs: { SLEEP: 0.9, WORK: 0.1 },
        l1_probs: { 'Night Sleep': 0.85, Nap: 0.15 },
        l2_probs: null,
        q10: 0,
        q50: 0,
        q90: 0,
      },
      {
        bucket_index: 30,
        start_time: '2026-07-16T15:00:00Z',
        l0_probs: { WORK: 0.72, LEISURE: 0.18, SLEEP: 0.1 },
        l1_probs: {},
        l2_probs: null,
        q10: 0,
        q50: 0,
        q90: 0,
      },
    ],
  };
}

// ── Schema validity ─────────────────────────────────────────────────────────────

describe('prediction/insight tool schemas', () => {
  const stub: any = new Proxy(function () {}, { get: () => stub, apply: () => stub });

  const tools = [
    new PredictionsForecastTool(stub, makeLogger()),
    new PredictionsCalibrationTool(stub, makeLogger()),
    new InsightsListTool(stub, stub, makeLogger()),
  ];

  it('declares registered domains (present in both IntentDomainKey and INTENT_DOMAINS)', () => {
    for (const tool of tools) {
      expect(isIntentDomain(tool.schema.domain)).toBe(true);

      const domain = INTENT_DOMAINS.find((d) => d.key === tool.schema.domain);
      expect(domain).toBeDefined();
      expect(domain!.title).toBeTruthy();
      expect(domain!.description).toBeTruthy();
    }
  });

  it('maps dotted intent names to executable tool names', () => {
    expect(tools.map((tool) => tool.schema.name).sort()).toEqual([
      'insights.list',
      'predictions.calibration',
      'predictions.forecast',
    ]);
    expect(intentToolName('predictions.forecast')).toBe('predictions_forecast');
    expect(intentToolName('predictions.calibration')).toBe('predictions_calibration');
    expect(intentToolName('insights.list')).toBe('insights_list');
  });

  it('is uniformly read-only, personal, non-destructive, and local', () => {
    for (const tool of tools) {
      expect(tool.schema.parameters.type).toBe('object');
      expect(tool.schema.privacy).toEqual({
        access: 'read',
        sensitivity: 'personal',
        destructive: false,
        external: false,
      });
      expect(tool.schema.phrases?.length).toBeGreaterThan(0);
      expect(tool.schema.title).toBeTruthy();
      expect(tool.schema.description).toBeTruthy();
    }
  });
});

// ── Forecast summarization ──────────────────────────────────────────────────────

describe('summarizeForecast', () => {
  it('reduces each histogram bucket to dominant L0 + top L1', () => {
    const output = summarizeForecast(makeForecastResponse());

    expect(output.horizon).toBe('24h');
    expect(output.generatedAt).toBe('2026-07-15T12:00:00Z');
    expect(output.systemStatus).toBe('READY');
    expect(output.bucketCount).toBe(2);

    const [sleep, work] = output.buckets;
    expect(sleep.bucketIndex).toBe(0);
    expect(sleep.startTime).toBe('2026-07-16T00:00:00Z');
    expect(sleep.dominantL0).toEqual({ label: 'SLEEP', probability: 0.9 });
    expect(sleep.topL1).toEqual({ label: 'Night Sleep', probability: 0.85 });

    expect(work.dominantL0).toEqual({ label: 'WORK', probability: 0.72 });
    // Empty L1 distribution → no top-L1 claim.
    expect(work.topL1).toBeNull();
  });

  it('breaks probability ties deterministically (alphabetically-first label)', () => {
    const response = makeForecastResponse();
    response.buckets = [{ ...response.buckets[0], l0_probs: { WORK: 0.5, LEISURE: 0.5 } }];

    const output = summarizeForecast(response);

    expect(output.buckets[0].dominantL0).toEqual({ label: 'LEISURE', probability: 0.5 });
  });
});

describe('PredictionsForecastTool', () => {
  it('fetches the histogram user-scoped and returns the summarized shape', async () => {
    const getForecast = jest.fn().mockResolvedValue(makeForecastResponse());
    const tool = new PredictionsForecastTool({ getForecast } as any, makeLogger());

    const result = await tool.execute(context, {});

    expect(getForecast).toHaveBeenCalledWith({ userId: USER_ID }, '24h');
    expect(result.success).toBe(true);
    expect(result.data!.systemStatus).toBe('READY');
    expect(result.data!.buckets[1].dominantL0!.label).toBe('WORK');
  });

  it('surfaces service failure as a tool error result', async () => {
    const getForecast = jest.fn().mockRejectedValue(new Error('Forecast service unavailable'));
    const tool = new PredictionsForecastTool({ getForecast } as any, makeLogger());

    const result = await tool.execute(context, {});

    expect(result.success).toBe(false);
    expect(result.error!.message).toBe('Forecast service unavailable');
  });
});

// ── Calibration quality statement ───────────────────────────────────────────────

describe('calibrationQualityStatement', () => {
  it('reports missing data when nothing has been scored', () => {
    expect(calibrationQualityStatement(null)).toMatch(/No scored forecasts yet/);
    expect(calibrationQualityStatement(makeScoreRow({ l0_top1_acc: null }))).toMatch(
      /No scored forecasts yet/,
    );
  });

  it('grades accuracy and calibration deterministically from thresholds', () => {
    expect(calibrationQualityStatement(makeScoreRow({ l0_top1_acc: 0.75, ece: 0.04 }))).toBe(
      'Forecast quality is strong: the top prediction matched observed behavior 75% of the time ' +
        'and its confidence is well calibrated.',
    );
    expect(calibrationQualityStatement(makeScoreRow({ l0_top1_acc: 0.55, ece: 0.1 }))).toBe(
      'Forecast quality is fair: the top prediction matched observed behavior 55% of the time ' +
        'and its confidence is roughly calibrated.',
    );
    expect(calibrationQualityStatement(makeScoreRow({ l0_top1_acc: 0.3, ece: 0.3 }))).toBe(
      'Forecast quality is weak: the top prediction matched observed behavior only 30% of the time ' +
        'but its stated confidence is poorly calibrated (probabilities overstate accuracy).',
    );
  });

  it('appends the drift warning when the drift flag is set', () => {
    const statement = calibrationQualityStatement(makeScoreRow({ drift_flag: true }));

    expect(statement).toMatch(/drifted below its trailing baseline\.$/);
  });

  it('omits the calibration clause when ece is unknown', () => {
    expect(calibrationQualityStatement(makeScoreRow({ l0_top1_acc: 0.75, ece: null }))).toBe(
      'Forecast quality is strong: the top prediction matched observed behavior 75% of the time.',
    );
  });
});

describe('PredictionsCalibrationTool', () => {
  it('returns the latest metrics with the honesty basis and quality line', async () => {
    const getScores = jest.fn().mockResolvedValue([makeScoreRow()]);
    const tool = new PredictionsCalibrationTool({ getScores } as any, makeLogger());

    const result = await tool.execute(context, {});

    expect(getScores).toHaveBeenCalledWith({ userId: USER_ID }, 1);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      scored: true,
      scoredAt: '2026-07-14T05:00:00.000Z',
      brier: 0.42,
      l0Top1Accuracy: 0.75,
      l1Top3Accuracy: 0.5,
      ece: 0.08,
      coverage: 0.96,
      driftFlag: false,
      basis: CALIBRATION_TOOL_BASIS,
    });
    expect(result.data!.quality).toMatch(/^Forecast quality is strong/);
  });

  it('returns an honest empty shape when no scoring run exists yet', async () => {
    const getScores = jest.fn().mockResolvedValue([]);
    const tool = new PredictionsCalibrationTool({ getScores } as any, makeLogger());

    const result = await tool.execute(context, {});

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      scored: false,
      scoredAt: null,
      brier: null,
      l0Top1Accuracy: null,
      driftFlag: false,
    });
    expect(result.data!.quality).toMatch(/No scored forecasts yet/);
  });
});

// ── Insights list ───────────────────────────────────────────────────────────────

function makeSummary(overrides: Record<string, unknown> = {}): any {
  return {
    summaryId: 'summary-1',
    periodEnd: new Date('2026-07-14T00:00:00.000Z'),
    keyInsights: ['Deep-work mornings continued all week.'],
    anomalies: [],
    ...overrides,
  };
}

function makeAction(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'action-1',
    title: 'Reply to the dentist',
    text: 'Reply to the dentist about rescheduling the cleaning.',
    dismissed: false,
    createdAt: new Date('2026-07-13T18:04:12.000Z'),
    ...overrides,
  };
}

function makeInsightsTool(summaries: any[], actions: any[]) {
  const findRecent = jest.fn().mockResolvedValue(summaries);
  const findAll = jest.fn().mockResolvedValue(actions);
  const tool = new InsightsListTool({ findRecent } as any, { findAll } as any, makeLogger());

  return { tool, findRecent, findAll };
}

describe('InsightsListTool', () => {
  it('flattens summary insights/anomalies and active actions into typed items, newest first', async () => {
    const { tool, findRecent, findAll } = makeInsightsTool(
      [
        makeSummary({
          summaryId: 'summary-1',
          anomalies: ['Unusually little movement recorded on Tuesday.'],
        }),
      ],
      [makeAction(), makeAction({ id: 'action-2', dismissed: true })],
    );

    const result = await tool.execute(context, {});

    expect(findRecent).toHaveBeenCalledWith({ userId: USER_ID }, 20);
    expect(findAll).toHaveBeenCalledWith({ userId: USER_ID });
    expect(result.success).toBe(true);
    expect(result.data!.items).toEqual([
      {
        id: 'summary-1',
        type: 'insight',
        text: 'Deep-work mornings continued all week.',
        occurredAt: '2026-07-14T00:00:00.000Z',
      },
      {
        id: 'summary-1',
        type: 'anomaly',
        text: 'Unusually little movement recorded on Tuesday.',
        occurredAt: '2026-07-14T00:00:00.000Z',
      },
      {
        id: 'action-1',
        type: 'action',
        text: 'Reply to the dentist about rescheduling the cleaning.',
        occurredAt: '2026-07-13T18:04:12.000Z',
      },
    ]);
  });

  it('excludes items older than since and respects the limit', async () => {
    const { tool } = makeInsightsTool(
      [
        makeSummary({ summaryId: 'new', periodEnd: new Date('2026-07-14T00:00:00.000Z') }),
        makeSummary({ summaryId: 'old', periodEnd: new Date('2026-06-01T00:00:00.000Z') }),
      ],
      [makeAction({ id: 'old-action', createdAt: new Date('2026-05-01T00:00:00.000Z') })],
    );

    const result = await tool.execute(context, { since: '2026-07-01', limit: 1 });

    expect(result.success).toBe(true);
    expect(result.data!.items).toHaveLength(1);
    expect(result.data!.items[0].id).toBe('new');
  });

  it('falls back to the action title when text is missing and drops empty items', async () => {
    const { tool } = makeInsightsTool([makeSummary({ keyInsights: ['   '] })], [makeAction({ text: null })]);

    const result = await tool.execute(context, {});

    expect(result.success).toBe(true);
    expect(result.data!.items).toEqual([
      {
        id: 'action-1',
        type: 'action',
        text: 'Reply to the dentist',
        occurredAt: '2026-07-13T18:04:12.000Z',
      },
    ]);
  });

  it('rejects an unparseable since value as a tool error', async () => {
    const { tool, findRecent } = makeInsightsTool([], []);

    const result = await tool.execute(context, { since: 'last tuesday-ish' });

    expect(result.success).toBe(false);
    expect(findRecent).not.toHaveBeenCalled();
  });
});
