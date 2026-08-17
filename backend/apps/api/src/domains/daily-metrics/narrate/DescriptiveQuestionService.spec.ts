import type { UserServiceContext } from '@ci/common/context';

import { shiftIso } from '../dateUtil';
import type { DailyMetricsService } from '../services/DailyMetricsService';
import {
  METRIC_KEYS,
  type DailyMetrics,
  type MetricCoverage,
  type MetricKey,
  type MetricValues,
} from '../types';

import { DescriptiveQuestionService } from './DescriptiveQuestionService';
import { TemplateNarrator, type Narrator } from './Narrator';
import { QUESTION_CATALOG, type QuestionSpec } from './questionCatalog';

const USER = '00000000-0000-0000-0000-0000000000aa';
const CONTEXT: UserServiceContext = { userId: USER };

function nullMetrics(): MetricValues {
  return Object.fromEntries(METRIC_KEYS.map((key) => [key, null])) as MetricValues;
}

function day(date: string, metric: MetricKey, value: number, coverage = 1): DailyMetrics {
  const metrics = nullMetrics();
  metrics[metric] = value;
  const cov = Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as MetricCoverage;
  cov[metric] = coverage;

  return { userId: USER, date, timezone: 'UTC', metrics, coverage: cov, computedAt: new Date() };
}

function makeMetricsService(rows: DailyMetrics[]) {
  return {
    getRange: jest.fn(async () => rows),
  };
}

function makeService(rows: DailyMetrics[], narrator: Narrator = new TemplateNarrator()) {
  const metricsService = makeMetricsService(rows);
  const service = new DescriptiveQuestionService(metricsService as unknown as DailyMetricsService, narrator);

  return { service, metricsService };
}

const SUM_SPEC: QuestionSpec = {
  key: 't.sum',
  category: 'Relationships',
  question: 'How many messages this window?',
  metric: 'n_messages',
  aggregate: 'sum',
  timeframe: { days: 3, label: 'the last 3 days' },
  format: 'int',
  template: '{value} messages over {timeframe}.',
};

describe('DescriptiveQuestionService.answer', () => {
  it('computes the value deterministically and narrates it with provenance', async () => {
    const rows = [
      day('2026-07-05', 'n_messages', 2),
      day('2026-07-06', 'n_messages', 3),
      day('2026-07-07', 'n_messages', 5),
    ];
    const { service, metricsService } = makeService(rows);

    const answer = await service.answer(CONTEXT, SUM_SPEC, { date: '2026-07-07' });

    expect(answer.value).toBe(10);
    expect(answer.text).toBe('10 messages over the last 3 days.');
    expect(answer.question).toBe(SUM_SPEC.question);
    expect(answer.provenance.sources).toEqual(['ci.communications']);
    expect(answer.provenance.daysWithData).toBe(3);
    expect(answer.provenance.metric).toBe('n_messages');
    // window is [anchor-2, anchor]
    expect(metricsService.getRange).toHaveBeenCalledWith(CONTEXT, '2026-07-05', '2026-07-07');
  });

  it('returns a null value and a "no data" sentence when nothing is available', async () => {
    const { service } = makeService([]);

    const answer = await service.answer(CONTEXT, SUM_SPEC, { date: '2026-07-07' });

    expect(answer.value).toBeNull();
    expect(answer.text).toContain("don't have enough data");
    expect(answer.provenance.daysWithData).toBe(0);
    expect(answer.provenance.coveragePct).toBe(0);
  });

  it('honors "latest" by picking the most recent day in the window', async () => {
    const rows = [
      day('2026-07-05', 'n_places', 1),
      day('2026-07-07', 'n_places', 4),
      day('2026-07-06', 'n_places', 9),
    ];
    const latestSpec: QuestionSpec = {
      ...SUM_SPEC,
      metric: 'n_places',
      aggregate: 'latest',
      template: '{value} places {timeframe}.',
    };
    const { service } = makeService(rows);

    const answer = await service.answer(CONTEXT, latestSpec, { date: '2026-07-07' });

    expect(answer.value).toBe(4); // the 07-07 row, not the larger 07-06
  });

  it('applies a scale (ratio -> percent) before formatting', async () => {
    const rows = [day('2026-07-06', 'outbound_ratio', 0.4), day('2026-07-07', 'outbound_ratio', 0.6)];
    const pctSpec: QuestionSpec = {
      key: 't.pct',
      category: 'Identity',
      question: 'How often do I initiate?',
      metric: 'outbound_ratio',
      aggregate: 'avg',
      timeframe: { days: 2, label: 'the last 2 days' },
      format: 'float1',
      scale: 100,
      unit: '%',
      template: 'You initiate about {value}% of conversations.',
    };
    const { service } = makeService(rows);

    const answer = await service.answer(CONTEXT, pctSpec, { date: '2026-07-07' });

    expect(answer.value).toBeCloseTo(50, 5); // avg(0.4,0.6)=0.5 -> *100
    expect(answer.text).toBe('You initiate about 50.0% of conversations.');
  });

  it('never lets the narrator change the computed number', async () => {
    const liarNarrator: Narrator = {
      async narrate() {
        return 'the answer is 999999';
      },
    };
    const rows = [day('2026-07-07', 'n_messages', 7)];
    const { service } = makeService(rows, liarNarrator);

    const answer = await service.answer(
      CONTEXT,
      { ...SUM_SPEC, timeframe: { days: 1, label: 'today' } },
      {
        date: '2026-07-07',
      },
    );

    expect(answer.text).toBe('the answer is 999999'); // narration is free-form
    expect(answer.value).toBe(7); // but the fact is unchanged
  });
});

describe('DescriptiveQuestionService.answerAll', () => {
  it('produces exactly one answer per catalog question', async () => {
    const { service } = makeService([]);
    const answers = await service.answerAll(CONTEXT, { date: '2026-07-07' });

    expect(answers).toHaveLength(QUESTION_CATALOG.length);
  });

  it('loads getRange once for the max catalog timeframe', async () => {
    const { service, metricsService } = makeService([]);
    const anchor = '2026-07-07';

    await service.answerAll(CONTEXT, { date: anchor });

    expect(metricsService.getRange).toHaveBeenCalledTimes(1);
    const maxDays = Math.max(
      ...QUESTION_CATALOG.map((spec) => {
        const type = spec.analyticType ?? 'descriptive';
        if (type === 'anomaly' || type === 'optimization') {
          return Math.max(spec.timeframe.days, 28);
        }

        return spec.timeframe.days;
      }),
    );
    expect(metricsService.getRange).toHaveBeenCalledWith(CONTEXT, shiftIso(anchor, -(maxDays - 1)), anchor);
  });
});

describe('DescriptiveQuestionService.listQuestions', () => {
  it('returns the catalog', () => {
    const { service } = makeService([]);

    expect(service.listQuestions()).toBe(QUESTION_CATALOG);
  });
});

describe('question catalog integrity', () => {
  it('every question references a real metric and a non-empty template', () => {
    for (const spec of QUESTION_CATALOG) {
      expect(METRIC_KEYS).toContain(spec.metric);
      if (spec.pairMetric) {
        expect(METRIC_KEYS).toContain(spec.pairMetric);
      }

      expect(spec.template.length).toBeGreaterThan(0);
      expect(spec.timeframe.days).toBeGreaterThan(0);
    }
  });

  it('correlational templates never claim causation', () => {
    for (const spec of QUESTION_CATALOG.filter((item) => item.analyticType === 'correlational')) {
      expect(spec.template.toLowerCase()).not.toMatch(/\bcauses\b/);
      expect(spec.pairMetric).toBeDefined();
    }
  });
});

describe('DescriptiveQuestionService correlational answers', () => {
  it('narrates an association without causal language', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => {
      const date = shiftIso('2026-07-07', -29 + index);
      const conversations = 4 + index * 0.2;

      return day(date, 'n_conversations', conversations);
    }).map((row, index) => {
      row.metrics.avg_sentiment = 0.1 + index * 0.01;
      row.coverage.avg_sentiment = 1;

      return row;
    });

    const spec = QUESTION_CATALOG.find((item) => item.key === 'corr.conversations_sentiment_90')!;
    const { service } = makeService(rows);
    const answer = await service.answer(CONTEXT, spec, { date: '2026-07-07' });

    expect(answer.value).not.toBeNull();
    expect(answer.text.toLowerCase()).toContain('associated');
    expect(answer.text.toLowerCase()).not.toMatch(/\bcauses\b/);
  });
});
