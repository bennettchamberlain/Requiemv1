import { Module } from '@nestjs/common';

import { LoggingModule } from '@ci/common/logging';
import { EventsModule } from '@ci/domains/events';
import { IntelligenceModule } from '@ci/domains/intelligence';
import { LLMModule } from '@ci/domains/llm';
import { MaintenanceModule } from '@ci/domains/maintenance';
import { MemoryModule } from '@ci/domains/memory';
import { PersonalizationModule } from '@ci/domains/personalization';
import { ScheduleModule } from '@ci/domains/schedule';

import './events';

import { EntityPromotionCron } from './cron/EntityPromotionCron';
import {
  SmartRotationAnswerInferCron,
  SmartRotationGraphEnrichCron,
  SmartRotationHydrateAnswersCron,
  SmartRotationHydrateInventoryCron,
  SmartRotationInsightsCron,
  SmartRotationPromotionReviewCron,
  SmartRotationQuestionFeedCron,
  SmartRotationScheduleSyncCron,
  SmartRotationSummariesCron,
} from './cron/SmartRotationScheduledCrons';
import { SmartRotationListener } from './listeners/SmartRotationListener';
import { ContextGapQuestionService } from './services/ContextGapQuestionService';
import { SmartRotationService } from './services/SmartRotationService';
import { SummaryServiceClient } from './services/SummaryServiceClient';

@Module({
  imports: [
    EventsModule,
    IntelligenceModule,
    LLMModule,
    MemoryModule,
    ScheduleModule,
    MaintenanceModule,
    PersonalizationModule,
    LoggingModule,
  ],
  providers: [
    SmartRotationService,
    SummaryServiceClient,
    ContextGapQuestionService,
    SmartRotationListener,
    SmartRotationQuestionFeedCron,
    SmartRotationAnswerInferCron,
    SmartRotationScheduleSyncCron,
    SmartRotationInsightsCron,
    SmartRotationSummariesCron,
    SmartRotationGraphEnrichCron,
    SmartRotationPromotionReviewCron,
    SmartRotationHydrateAnswersCron,
    SmartRotationHydrateInventoryCron,
    EntityPromotionCron,
  ],
  exports: [SmartRotationService],
})
export class SmartRotationModule {}

export { SmartRotationService };
