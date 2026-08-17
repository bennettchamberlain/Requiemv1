import { Inject, Injectable } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';

import { shiftIso, todayIso } from '../dateUtil';
import { DailyMetricsService } from '../services/DailyMetricsService';
import { METRIC_SOURCES, type DailyMetrics } from '../types';

import { aggregateMetric, applyScale, meanCoverage } from './answerMath';
import { NARRATOR, type AnswerProvenance, type Narrator } from './Narrator';
import { QUESTION_CATALOG, type QuestionSpec } from './questionCatalog';

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
}

/**
 * Compute-then-narrate: for each descriptive question spec it (1) reads the
 * pre-computed daily_metrics over the question's timeframe, (2) aggregates the
 * metric deterministically into a value + provenance, then (3) hands that to a
 * Narrator for phrasing. The narrator only affects `.text`; `.value` is always
 * the computed number, so a swapped-in LLM narrator can never change the fact.
 */
@Injectable()
export class DescriptiveQuestionService {
  constructor(
    private readonly metricsService: DailyMetricsService,
    @Inject(NARRATOR) private readonly narrator: Narrator,
  ) {}

  listQuestions(): readonly QuestionSpec[] {
    return QUESTION_CATALOG;
  }

  async answer(
    context: UserServiceContext,
    spec: QuestionSpec,
    options: AnswerOptions = {},
  ): Promise<DescriptiveAnswer> {
    const anchor = options.date ?? todayIso();
    const from = shiftIso(anchor, -(spec.timeframe.days - 1));
    const rows = await this.metricsService.getRange(context, from, anchor);

    return this.answerFromRows(spec, rows);
  }

  /** Answer the whole catalog for one anchor date (one getRange for the max window). */
  async answerAll(context: UserServiceContext, options: AnswerOptions = {}): Promise<DescriptiveAnswer[]> {
    const anchor = options.date ?? todayIso();
    const maxDays = Math.max(...QUESTION_CATALOG.map((spec) => spec.timeframe.days));
    const from = shiftIso(anchor, -(maxDays - 1));
    const rows = await this.metricsService.getRange(context, from, anchor);

    const answers: DescriptiveAnswer[] = [];
    for (const spec of QUESTION_CATALOG) {
      const specFrom = shiftIso(anchor, -(spec.timeframe.days - 1));
      const window = rows.filter((row) => row.date >= specFrom && row.date <= anchor);
      answers.push(await this.answerFromRows(spec, window));
    }

    return answers;
  }

  private async answerFromRows(spec: QuestionSpec, rows: DailyMetrics[]): Promise<DescriptiveAnswer> {
    const aggregated = aggregateMetric(rows, spec.metric, spec.aggregate);
    const scaled = aggregated === null ? null : applyScale(aggregated.value, spec.scale);
    const daysWithData = aggregated?.daysWithData ?? 0;
    const coveragePct = Math.round(meanCoverage(rows, spec.metric) * 100);

    const provenance: AnswerProvenance = {
      metric: spec.metric,
      sources: METRIC_SOURCES[spec.metric],
      daysWithData,
      coveragePct,
    };

    const text = await this.narrator.narrate({
      spec,
      value: scaled,
      timeframe: spec.timeframe,
      days: spec.timeframe.days,
      daysWithData,
      coveragePct,
    });

    return {
      key: spec.key,
      category: spec.category,
      question: spec.question,
      text,
      value: scaled,
      unit: spec.unit,
      timeframe: spec.timeframe.label,
      provenance,
    };
  }
}
