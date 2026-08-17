import { Inject, Injectable, Optional } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';

import { robustZAt, type SeriesPoint } from '../anomaly/anomalyMath';
import { associate, pairDays } from '../correlation/correlationMath';
import { shiftIso, todayIso } from '../dateUtil';
import { MetricForecastService } from '../forecast/MetricForecastService';
import { DailyMetricsService } from '../services/DailyMetricsService';
import { detectArmTriggers, SUGGESTION_MIN_BASELINE_N } from '../suggest/suggestionMath';
import { METRIC_SOURCES, type DailyMetrics } from '../types';

import { aggregateMetric, applyScale, meanCoverage } from './answerMath';
import { NARRATOR, type AnswerProvenance, type Narrator } from './Narrator';
import { QUESTION_CATALOG, type AnalyticType, type QuestionSpec } from './questionCatalog';

export interface DescriptiveAnswer {
  key: string;
  category: string;
  question: string;
  /** The narrated sentence. */
  text: string;
  /** The deterministically computed value (null when there's no data). */
  value: number | null;
  unit?: string;
  timeframe: string;
  provenance: AnswerProvenance;
}

export interface AnswerOptions {
  /** Anchor date (YYYY-MM-DD), inclusive end of every timeframe. Defaults to today (UTC). */
  date?: string;
  analyticType?: AnalyticType;
}

/**
 * Compute-then-narrate: for each question spec it computes a value + provenance
 * deterministically, then hands that to a Narrator for phrasing. The narrator
 * only affects `.text`; `.value` is always the computed number.
 */
@Injectable()
export class DescriptiveQuestionService {
  constructor(
    private readonly metricsService: DailyMetricsService,
    @Inject(NARRATOR) private readonly narrator: Narrator,
    @Optional() private readonly metricForecastService?: MetricForecastService,
  ) {}

  listQuestions(analyticType?: AnalyticType): readonly QuestionSpec[] {
    if (!analyticType) {
      return QUESTION_CATALOG;
    }

    return QUESTION_CATALOG.filter((spec) => (spec.analyticType ?? 'descriptive') === analyticType);
  }

  async answer(
    context: UserServiceContext,
    spec: QuestionSpec,
    options: AnswerOptions = {},
  ): Promise<DescriptiveAnswer> {
    const anchor = options.date ?? todayIso();
    const from = shiftIso(anchor, -(lookbackDays(spec) - 1));
    const rows = await this.metricsService.getRange(context, from, anchor);

    return this.answerFromRows(context, spec, rows, anchor);
  }

  /** Answer the catalog (optionally one analytic type) for one anchor date. */
  async answerAll(context: UserServiceContext, options: AnswerOptions = {}): Promise<DescriptiveAnswer[]> {
    const catalog = this.listQuestions(options.analyticType);
    const anchor = options.date ?? todayIso();
    const maxDays = Math.max(1, ...catalog.map(lookbackDays));
    const from = shiftIso(anchor, -(maxDays - 1));
    const rows = await this.metricsService.getRange(context, from, anchor);

    const answers: DescriptiveAnswer[] = [];
    for (const spec of catalog) {
      const specFrom = shiftIso(anchor, -(lookbackDays(spec) - 1));
      const window = rows.filter((row) => row.date >= specFrom && row.date <= anchor);
      answers.push(await this.answerFromRows(context, spec, window, anchor));
    }

    return answers;
  }

  private async answerFromRows(
    context: UserServiceContext,
    spec: QuestionSpec,
    rows: DailyMetrics[],
    anchor: string,
  ): Promise<DescriptiveAnswer> {
    const type = spec.analyticType ?? 'descriptive';
    if (type === 'correlational') {
      return this.answerCorrelation(spec, rows);
    }

    if (type === 'anomaly') {
      return this.answerAnomaly(spec, rows, anchor);
    }

    if (type === 'optimization') {
      return this.answerOptimization(spec, rows, anchor);
    }

    if (type === 'predictive') {
      return this.answerForecast(context, spec, anchor);
    }

    return this.answerDescriptive(spec, rows);
  }

  private async answerDescriptive(spec: QuestionSpec, rows: DailyMetrics[]): Promise<DescriptiveAnswer> {
    const aggregated = aggregateMetric(rows, spec.metric, spec.aggregate);
    const scaled = aggregated === null ? null : applyScale(aggregated.value, spec.scale);
    const daysWithData = aggregated?.daysWithData ?? 0;
    const coveragePct = Math.round(meanCoverage(rows, spec.metric) * 100);

    return this.finish(spec, scaled, daysWithData, coveragePct);
  }

  private async answerCorrelation(spec: QuestionSpec, rows: DailyMetrics[]): Promise<DescriptiveAnswer> {
    const other = spec.pairMetric;
    if (!other) {
      return this.finish(spec, null, 0, 0);
    }

    const points = pairDays(rows, spec.metric, other, spec.lagDays ?? 0);
    const association = associate(points);
    if (!association) {
      return this.finish(spec, null, points.length, 0, { lag: spec.lagDays ?? 0, q: 'n/a', effect: 'n/a' });
    }

    return this.finish(
      spec,
      association.effect,
      association.n,
      Math.round(association.coverageMean * 100),
      {
        effect: association.effect.toFixed(2),
        lag: spec.lagDays ?? 0,
        q: association.pValue.toExponential(2),
      },
    );
  }

  private async answerAnomaly(
    spec: QuestionSpec,
    rows: DailyMetrics[],
    anchor: string,
  ): Promise<DescriptiveAnswer> {
    const series: SeriesPoint[] = rows
      .filter((row) => row.metrics[spec.metric] !== null)
      .map((row) => ({
        date: row.date,
        value: row.metrics[spec.metric] as number,
        coverage: row.coverage[spec.metric] ?? 0,
      }));

    const finding = robustZAt(series, anchor);
    if (!finding) {
      return this.finish(spec, null, series.length, Math.round(meanCoverage(rows, spec.metric) * 100), {
        baseline: 'n/a',
      });
    }

    return this.finish(spec, finding.value, series.length, Math.round((finding.coverage ?? 0) * 100), {
      baseline: finding.baseline === null ? 'n/a' : finding.baseline.toFixed(1),
    });
  }

  private async answerOptimization(
    spec: QuestionSpec,
    rows: DailyMetrics[],
    anchor: string,
  ): Promise<DescriptiveAnswer> {
    const yesterday = rows.find((row) => row.date === anchor) ?? null;
    const window = rows.filter((row) => row.date !== anchor);
    const triggers = detectArmTriggers(yesterday, window, Math.min(3, SUGGESTION_MIN_BASELINE_N));
    const hit = triggers.find((trigger) => trigger.key === spec.suggestionKey || trigger.metric === spec.metric);
    if (!hit) {
      return this.finish(spec, null, window.length, 0, { baseline: 'n/a' });
    }

    return this.finish(spec, hit.current, window.length, 100, { baseline: String(Math.round(hit.baseline)) });
  }

  private async answerForecast(
    context: UserServiceContext,
    spec: QuestionSpec,
    anchor: string,
  ): Promise<DescriptiveAnswer> {
    if (!this.metricForecastService) {
      return this.finish(spec, null, 0, 0);
    }

    const forecast = await this.metricForecastService.forecast(context, spec.metric, spec.timeframe.days, {
      date: anchor,
    });
    if (forecast.status !== 'OK' || forecast.points.length === 0) {
      return this.finish(spec, null, 0, Math.round(forecast.coverage * 100));
    }

    const mean = forecast.points.reduce((sum, point) => sum + point.q50, 0) / forecast.points.length;

    return this.finish(spec, mean, forecast.points.length, Math.round(forecast.coverage * 100));
  }

  private async finish(
    spec: QuestionSpec,
    value: number | null,
    daysWithData: number,
    coveragePct: number,
    extra: Record<string, string | number> = {},
  ): Promise<DescriptiveAnswer> {
    const provenance: AnswerProvenance = {
      metric: spec.metric,
      sources: METRIC_SOURCES[spec.metric],
      daysWithData,
      coveragePct,
    };

    const text = await this.narrator.narrate({
      spec,
      value,
      timeframe: spec.timeframe,
      days: spec.timeframe.days,
      daysWithData,
      coveragePct,
      extra,
    });

    return {
      key: spec.key,
      category: spec.category,
      question: spec.question,
      text,
      value,
      unit: spec.unit,
      timeframe: spec.timeframe.label,
      provenance,
    };
  }
}

/** Anomaly / optimization questions are about the anchor day but need a baseline window. */
function lookbackDays(spec: QuestionSpec): number {
  const type = spec.analyticType ?? 'descriptive';
  if (type === 'anomaly' || type === 'optimization') {
    return Math.max(spec.timeframe.days, 28);
  }

  return spec.timeframe.days;
}
