import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

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
 * The insights domain: the Daily Feature Store (DailyMetricsService over
 * ci_derived.daily_metrics) plus the descriptive compute-then-narrate question
 * engine (DescriptiveQuestionService), the next-place prediction engine
 * (PlaceClusterService + PlaceTransitionService over ci_derived.place_*), and
 * the metric forecaster (MetricForecastService, q10/q50/q90 over the feature
 * store). NARRATOR is bound to the dependency-free TemplateNarrator by
 * default; a deployment can rebind it to an Ollama-backed OllamaNarrator
 * without touching the compute path.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailyMetricEntity,
      PlaceClusterEntity,
      PlaceTransitionEntity,
      PlaceForecastLogEntity,
    ]),
  ],
  providers: [
    DailyMetricsService,
    DescriptiveQuestionService,
    MetricForecastService,
    PlaceClusterService,
    PlaceTransitionService,
    { provide: NARRATOR, useClass: TemplateNarrator },
  ],
  exports: [
    DailyMetricsService,
    DescriptiveQuestionService,
    MetricForecastService,
    PlaceClusterService,
    PlaceTransitionService,
  ],
})
export class InsightsModule {}

export { DailyMetricsService } from './services/DailyMetricsService';
export { DescriptiveQuestionService } from './narrate/DescriptiveQuestionService';
export type { DescriptiveAnswer, AnswerOptions } from './narrate/DescriptiveQuestionService';
export { DailyMetricEntity } from './entities/DailyMetricEntity';
export { PlaceClusterEntity } from './entities/PlaceClusterEntity';
export { PlaceTransitionEntity } from './entities/PlaceTransitionEntity';
export { PlaceForecastLogEntity } from './entities/PlaceForecastLogEntity';
export type { PlaceForecastLogPrediction } from './entities/PlaceForecastLogEntity';
export { PlaceClusterService } from './places/PlaceClusterService';
export type { BuildClustersOptions } from './places/PlaceClusterService';
export { PlaceTransitionService } from './places/PlaceTransitionService';
export type {
  PredictNextOptions,
  RebuildTransitionsOptions,
  ScoreLogOptions,
} from './places/PlaceTransitionService';
export type {
  BuildClustersResult,
  PlaceClusterSnapshot,
  PlaceForecast,
  PlaceForecastScore,
  PlaceForecastStatus,
  PlacePrediction,
} from './places/types';
export type { BackoffLevel, ClusterVisit, HeatCell } from './places/transitionMath';
export { MetricForecastService } from './forecast/MetricForecastService';
export type {
  MetricForecast,
  MetricForecastOptions,
  MetricForecastStatus,
} from './forecast/MetricForecastService';
export type { ForecastPoint as MetricForecastPoint } from './forecast/forecastMath';
export { NARRATOR, TemplateNarrator, OllamaNarrator, interpolateTemplate } from './narrate/Narrator';
export type { Narrator, TextGenerator, NarrationInput, AnswerProvenance } from './narrate/Narrator';
export { QUESTION_CATALOG } from './narrate/questionCatalog';
export type { QuestionSpec, Category } from './narrate/questionCatalog';
export { METRIC_KEYS, METRIC_SOURCES } from './types';
export type { DailyMetrics, MetricKey, MetricValues, MetricCoverage } from './types';
