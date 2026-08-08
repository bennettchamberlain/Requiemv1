import { Module } from '@nestjs/common';

import { LoggingModule } from '@ci/common/logging';
import { EventsModule } from '@ci/domains/events';
import { IntelligenceModule } from '@ci/domains/intelligence';
import { MaintenanceModule } from '@ci/domains/maintenance';
import { ScheduleModule } from '@ci/domains/schedule';

import './events';

import {
  SmartRotationAnswerInferCron,
  SmartRotationGraphEnrichCron,
  SmartRotationInsightsCron,
  SmartRotationQuestionFeedCron,
  SmartRotationScheduleSyncCron,
  SmartRotationSummariesCron,
} from './cron/SmartRotationScheduledCrons';
import { SmartRotationListener } from './listeners/SmartRotationListener';
import { SmartRotationService } from './services/SmartRotationService';
import { SummaryServiceClient } from './services/SummaryServiceClient';

@Module({
  imports: [EventsModule, IntelligenceModule, ScheduleModule, MaintenanceModule, LoggingModule],
  providers: [
    SmartRotationService,
    SummaryServiceClient,
    SmartRotationListener,
    SmartRotationQuestionFeedCron,
    SmartRotationAnswerInferCron,
    SmartRotationScheduleSyncCron,
    SmartRotationInsightsCron,
    SmartRotationSummariesCron,
    SmartRotationGraphEnrichCron,
  ],
  exports: [SmartRotationService],
})
export class SmartRotationModule {}

export { SmartRotationService };
