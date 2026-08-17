import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { UserModule } from '@ci/domains/user';

import { DailyMetricsCron } from './cron/DailyMetricsCron';
import { DailyMetricEntity } from './entities/DailyMetricEntity';
import { PlaceClusterEntity } from './entities/PlaceClusterEntity';
import { PlaceForecastLogEntity } from './entities/PlaceForecastLogEntity';
import { PlaceTransitionEntity } from './entities/PlaceTransitionEntity';
import { MetricForecastService } from './forecast/MetricForecastService';
import { DescriptiveQuestionService } from './narrate/DescriptiveQuestionService';
import { NARRATOR, TemplateNarrator } from './narrate/Narrator';
import { PlaceClusterService } from './places/PlaceClusterService';
import { PlaceTransitionService } from './places/PlaceTransitionService';
import { DailyMetricsService } from './services/DailyMetricsService';

/**
 * The daily-metrics domain: the Daily Feature Store (DailyMetricsService over
 * ci_derived.daily_metrics) plus the descriptive compute-then-narrate question
 * engine (DescriptiveQuestionService). NARRATOR is bound to the dependency-free
 * TemplateNarrator by default; a deployment can rebind it to an Ollama-backed
 * OllamaNarrator without touching the compute path.
 *
 * Also owns the 1729 stay-point / recency-decayed transition engine
 * (PlaceClusterService + PlaceTransitionService over ci_derived.place_*).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailyMetricEntity,
      PlaceClusterEntity,
      PlaceTransitionEntity,
      PlaceForecastLogEntity,
    ]),
    UserModule,
  ],
  providers: [
    DailyMetricsService,
    DailyMetricsCron,
    DescriptiveQuestionService,
    MetricForecastService,
    PlaceClusterService,
    PlaceTransitionService,
    { provide: NARRATOR, useClass: TemplateNarrator },
  ],
  exports: [DailyMetricsService, DescriptiveQuestionService, MetricForecastService, PlaceTransitionService],
})
export class DailyMetricsModule {}

export { DailyMetricsService, DEFAULT_REFRESH_WINDOW_DAYS } from './services/DailyMetricsService';
export { MetricForecastService } from './forecast/MetricForecastService';
export type { MetricForecast, MetricForecastStatus } from './forecast/MetricForecastService';
export type { ForecastPoint } from './forecast/forecastMath';
export { DescriptiveQuestionService } from './narrate/DescriptiveQuestionService';
export type { DescriptiveAnswer, AnswerOptions } from './narrate/DescriptiveQuestionService';
export { DailyMetricEntity } from './entities/DailyMetricEntity';
export { PlaceClusterEntity } from './entities/PlaceClusterEntity';
export { PlaceTransitionEntity } from './entities/PlaceTransitionEntity';
export { PlaceForecastLogEntity } from './entities/PlaceForecastLogEntity';
export { PlaceClusterService } from './places/PlaceClusterService';
export { PlaceTransitionService } from './places/PlaceTransitionService';
export type { PlaceForecast, PlacePrediction, PlaceForecastScore } from './places/types';
export { NARRATOR, TemplateNarrator, OllamaNarrator, interpolateTemplate } from './narrate/Narrator';
export type { Narrator, TextGenerator, NarrationInput, AnswerProvenance } from './narrate/Narrator';
export { QUESTION_CATALOG } from './narrate/questionCatalog';
export type { QuestionSpec, Category } from './narrate/questionCatalog';
export { pickMetricSurprise } from './grounded/metricSurprises';
export type { MetricSurprise } from './grounded/metricSurprises';
export { shiftIso, todayIsoInTimezone } from './dateUtil';
export { METRIC_KEYS, METRIC_SOURCES } from './types';
export type { DailyMetrics, MetricKey, MetricValues, MetricCoverage } from './types';
