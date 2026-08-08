import { Injectable } from '@nestjs/common';

import { Cron } from '@ci/common/schedule';

import { SmartRotationService } from '../services/SmartRotationService';
import { SMART_ROTATION_CRONS } from '../types';

/** Question feed top-up — same 20m cadence as the legacy FeedQueueCron. */
@Injectable()
export class SmartRotationQuestionFeedCron {
  constructor(private readonly rotationService: SmartRotationService) {}

  @Cron(SMART_ROTATION_CRONS.question_feed)
  async run(): Promise<void> {
    await this.rotationService.runScheduledWork('question_feed');
  }
}

/** Answer inference — throttled to 20m under smart.rotation (legacy ran every minute). */
@Injectable()
export class SmartRotationAnswerInferCron {
  constructor(private readonly rotationService: SmartRotationService) {}

  @Cron(SMART_ROTATION_CRONS.answer_infer)
  async run(): Promise<void> {
    await this.rotationService.runScheduledWork('answer_infer');
  }
}

/** Schedule slate sync — every 30 minutes at :14. */
@Injectable()
export class SmartRotationScheduleSyncCron {
  constructor(private readonly rotationService: SmartRotationService) {}

  @Cron(SMART_ROTATION_CRONS.schedule_sync)
  async run(): Promise<void> {
    await this.rotationService.runScheduledWork('schedule_sync');
  }
}

/** Proactive insights — every 3 hours (matches summary-service system schedule). */
@Injectable()
export class SmartRotationInsightsCron {
  constructor(private readonly rotationService: SmartRotationService) {}

  @Cron(SMART_ROTATION_CRONS.insights)
  async run(): Promise<void> {
    await this.rotationService.runScheduledWork('insights');
  }
}

/** Activity summaries / dossier refresh — hourly. */
@Injectable()
export class SmartRotationSummariesCron {
  constructor(private readonly rotationService: SmartRotationService) {}

  @Cron(SMART_ROTATION_CRONS.summaries)
  async run(): Promise<void> {
    await this.rotationService.runScheduledWork('summaries');
  }
}

/** Graph relationship enrichment — every 6 hours. */
@Injectable()
export class SmartRotationGraphEnrichCron {
  constructor(private readonly rotationService: SmartRotationService) {}

  @Cron(SMART_ROTATION_CRONS.graph_enrich)
  async run(): Promise<void> {
    await this.rotationService.runScheduledWork('graph_enrich');
  }
}
