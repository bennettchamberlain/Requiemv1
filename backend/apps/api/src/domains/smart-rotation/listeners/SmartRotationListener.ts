import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { Events, EventService, OnEvent } from '@ci/domains/events';
import { QuestionService } from '@ci/domains/intelligence';
import { GraphEnrichmentService } from '@ci/domains/maintenance';
import { SuggestionSyncService } from '@ci/domains/schedule';

import { SmartRotationWorkEvent, type SmartRotationWorkPayload } from '../events';
import { SummaryServiceClient } from '../services/SummaryServiceClient';
import { SMART_ROTATION_QUEUE, type SmartRotationWorkType } from '../types';


const FEED_QUEUE_LIMIT = 3;

@Injectable()
export class SmartRotationListener {
  constructor(
    private readonly questionService: QuestionService,
    private readonly eventService: EventService,
    private readonly suggestionSyncService: SuggestionSyncService,
    private readonly summaryServiceClient: SummaryServiceClient,
    private readonly graphEnrichmentService: GraphEnrichmentService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(SmartRotationListener.name);
  }

  @OnEvent(SmartRotationWorkEvent, { queue: SMART_ROTATION_QUEUE })
  async handleWork(payload: SmartRotationWorkPayload): Promise<void> {
    await this.executeWork(payload.userId, payload.workType);
  }

  private async executeWork(userId: string, workType: SmartRotationWorkType): Promise<void> {
    switch (workType) {
      case 'question_feed': {
        const enqueued = await this.questionService.enqueueNextFeedQueueQuestion(userId, FEED_QUEUE_LIMIT);

        this.logger.log('Smart rotation question feed', { userId, enqueued });

        return;
      }

      case 'answer_infer': {
        const questionId = await this.findTopUnansweredQuestionId(userId);

        if (!questionId) {
          this.logger.log('Smart rotation answer infer skipped — no unanswered questions', { userId });

          return;
        }

        await this.eventService.send(Events.INFER_QUESTION_ANSWER, {
          ownerId: userId,
          questionId,
        });

        this.logger.log('Smart rotation answer infer enqueued', { userId, questionId });

        return;
      }

      case 'schedule_sync': {
        const context = { userId } as UserServiceContext;
        const written = await this.suggestionSyncService.sync(context);

        this.logger.log('Smart rotation schedule sync', { userId, written });

        return;
      }

      case 'insights': {
        const result = await this.summaryServiceClient.generateInsights(userId);

        this.logger.log('Smart rotation insights', { userId, status: result.status, reason: result.reason });

        return;
      }

      case 'summaries': {
        const hoursSince = await this.hoursSinceLastSummary(userId);
        const periodType = hoursSince == null || hoursSince >= 24 ? 'dossier' : 'hourly';
        const result = await this.summaryServiceClient.triggerSummary(userId, periodType);

        this.logger.log('Smart rotation summary', { userId, periodType, status: result.status });

        return;
      }

      case 'graph_enrich': {
        const result = await this.graphEnrichmentService.enrich(userId, {
          maxCommunications: 20,
          maxEvents: 10,
        });

        this.logger.log('Smart rotation graph enrich', {
          userId,
          sampledRecords: result.sampledRecords,
          preferenceEdgesWritten: result.preferenceEdgesWritten,
          familyEdgesWritten: result.familyEdgesWritten,
        });

        return;
      }

      default:
        throw new Error(`Unknown smart rotation work type: ${workType satisfies never}`);
    }
  }

  private async hoursSinceLastSummary(userId: string): Promise<number | null> {
    type Row = { created_at: Date | null };
    const rows = (await this.dataSource.query(
      `
      SELECT MAX(created_at) AS created_at
      FROM ci.summaries
      WHERE user_id = $1
        AND period_type != 'insight';
      `,
      [userId],
    )) as Row[];

    const createdAt = rows[0]?.created_at;

    if (!createdAt) {
      return null;
    }

    return (Date.now() - new Date(createdAt).getTime()) / 3_600_000;
  }

  private async findTopUnansweredQuestionId(userId: string): Promise<string | null> {
    type Row = { id: string };
    const rows = (await this.dataSource.query(
      `
      SELECT q.question_id AS id
      FROM ci.questions q
      WHERE q.user_id IS NULL
        AND q.active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM ci.answers a
          WHERE a.question_id = q.question_id
            AND a.user_id = $1
        )
      ORDER BY q.created_at ASC
      LIMIT 1;
      `,
      [userId],
    )) as Row[];

    return rows[0]?.id ?? null;
  }
}
