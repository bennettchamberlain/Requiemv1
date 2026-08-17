import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IntelligenceModule } from '@ci/domains/intelligence';
import { UserModule } from '@ci/domains/user';

import { AnomalyEngine } from './anomaly/AnomalyEngine';
import { CorrelationEngine } from './correlation/CorrelationEngine';
import { DailyMetricsCron } from './cron/DailyMetricsCron';
import { DailyMetricEntity } from './entities/DailyMetricEntity';
import { MetricAnomalyEntity } from './entities/MetricAnomalyEntity';
import { MetricCorrelationEntity } from './entities/MetricCorrelationEntity';
import { MetricSuggestionEntity } from './entities/MetricSuggestionEntity';
import { SuggestionArmEntity } from './entities/SuggestionArmEntity';
import { MetricForecastService } from './forecast/MetricForecastService';
import { DescriptiveQuestionService } from './narrate/DescriptiveQuestionService';
import { NARRATOR, TemplateNarrator } from './narrate/Narrator';
import { DailyMetricsService } from './services/DailyMetricsService';
import { DerivationScanService } from './services/DerivationScanService';
import { SuggestionEngine } from './suggest/SuggestionEngine';

/**
 * The daily-metrics domain: the Daily Feature Store plus compute-then-narrate
 * and the correlation / anomaly / suggestion engines.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DailyMetricEntity,
      MetricCorrelationEntity,
      MetricAnomalyEntity,
      MetricSuggestionEntity,
      SuggestionArmEntity,
    ]),
    UserModule,
    IntelligenceModule,
  ],
  providers: [
    DailyMetricsService,
    DailyMetricsCron,
    DescriptiveQuestionService,
    MetricForecastService,
    CorrelationEngine,
    AnomalyEngine,
    SuggestionEngine,
    DerivationScanService,
    { provide: NARRATOR, useClass: TemplateNarrator },
  ],
  exports: [
    DailyMetricsService,
    DescriptiveQuestionService,
    MetricForecastService,
    CorrelationEngine,
    AnomalyEngine,
    SuggestionEngine,
    DerivationScanService,
  ],
})
export class DailyMetricsModule {}

export { DailyMetricsService, DEFAULT_REFRESH_WINDOW_DAYS } from './services/DailyMetricsService';
export { DerivationScanService } from './services/DerivationScanService';
export { MetricForecastService } from './forecast/MetricForecastService';
export type { MetricForecast, MetricForecastStatus } from './forecast/MetricForecastService';
export type { ForecastPoint } from './forecast/forecastMath';
export { DescriptiveQuestionService } from './narrate/DescriptiveQuestionService';
export type { DescriptiveAnswer, AnswerOptions } from './narrate/DescriptiveQuestionService';
export { DailyMetricEntity } from './entities/DailyMetricEntity';
export { MetricCorrelationEntity } from './entities/MetricCorrelationEntity';
export type { MetricCorrelation } from './entities/MetricCorrelationEntity';
export { MetricAnomalyEntity } from './entities/MetricAnomalyEntity';
export type { MetricAnomaly } from './entities/MetricAnomalyEntity';
export { MetricSuggestionEntity } from './entities/MetricSuggestionEntity';
export type { MetricSuggestion } from './entities/MetricSuggestionEntity';
export { CorrelationEngine } from './correlation/CorrelationEngine';
export { AnomalyEngine } from './anomaly/AnomalyEngine';
export { SuggestionEngine } from './suggest/SuggestionEngine';
export { NARRATOR, TemplateNarrator, OllamaNarrator, interpolateTemplate } from './narrate/Narrator';
export type { Narrator, TextGenerator, NarrationInput, AnswerProvenance } from './narrate/Narrator';
export { QUESTION_CATALOG } from './narrate/questionCatalog';
export type { QuestionSpec, Category, AnalyticType } from './narrate/questionCatalog';
export { pickMetricSurprise, pickMetricSurpriseFromAnomalies } from './grounded/metricSurprises';
export type { MetricSurprise } from './grounded/metricSurprises';
export { shiftIso, todayIsoInTimezone } from './dateUtil';
export { METRIC_KEYS, METRIC_SOURCES } from './types';
export type { DailyMetrics, MetricKey, MetricValues, MetricCoverage } from './types';
