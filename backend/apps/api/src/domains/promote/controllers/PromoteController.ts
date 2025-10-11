import { Controller } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import config from '@ci/configuration';
import { Events, type EventPayloads, OnEvent } from '@ci/domains/events';

import { ApiLogEntity } from '../../etl/entities/ApiLogEntity';
import { GoogleCalendarEventPromotionService } from '../services/CalendarPromotionService';
import { GmailPromotionService } from '../services/GmailPromotionService';
import { PromoteService } from '../services/PromoteService';

@Controller('promote')
export class PromoteController {
  private logger = new LoggerService(PromoteController.name);

  constructor(
    private readonly promoteService: PromoteService,
    private readonly gmailPromotionService: GmailPromotionService,
    private readonly calendarPromotionService: GoogleCalendarEventPromotionService,
    @InjectRepository(ApiLogEntity)
    private readonly apiLogRepository: Repository<ApiLogEntity>,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async promoteApiLogs(): Promise<void> {
    if (!config.features['scheduled.entity.promotion']) {
      this.logger.log('Scheduled entity promotion is disabled');

      return;
    }

    this.logger.log('Starting scheduled API log promotion');

    try {
      // Get all users who have unprocessed API logs with active connections and valid tokens
      const usersWithUnprocessedLogs = await this.apiLogRepository
        .createQueryBuilder('apiLog')
        .innerJoin('apiLog.connection', 'connection')
        .select('DISTINCT apiLog.user_id', 'userId')
        .where('apiLog.last_processed IS NULL')
        .andWhere('apiLog.user_id IS NOT NULL')
        .andWhere('apiLog.connection_id IS NOT NULL')
        .andWhere('connection.active = true')
        .andWhere('connection.access_token IS NOT NULL')
        .andWhere('connection.token_expiry > :currentDate', { currentDate: new Date() })
        .getRawMany();

      this.logger.log('Found users with unprocessed API logs', {
        userCount: usersWithUnprocessedLogs.length,
      });

      for (const { userId } of usersWithUnprocessedLogs) {
        if (userId) {
          await this.promoteService.promoteApiLogs(userId);
        }
      }

      this.logger.log('Completed promote API logs for all users', {
        processedUserCount: usersWithUnprocessedLogs.length,
      });
    } catch (error) {
      this.logger.error('Error promoting API logs', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Handle Gmail message promotion event
   * This runs asynchronously in the job queue after the API log has been marked as processed
   * Promotes Gmail messages to the communications table and creates person entities
   */
  @OnEvent(Events.PROMOTE_GMAIL_MESSAGES)
  async handlePromoteGmailMessages(payload: EventPayloads[Events.PROMOTE_GMAIL_MESSAGES]) {
    this.logger.log('Processing Gmail promotion job', {
      apiLogId: payload.apiLogId,
      userId: payload.userId,
    });

    try {
      await this.gmailPromotionService.promoteGmailMessages(
        payload.content,
        payload.userId,
        payload.connectionId,
      );

      this.logger.log('Gmail promotion completed successfully', {
        apiLogId: payload.apiLogId,
      });
    } catch (error) {
      // Log as warning - job will complete anyway to avoid infinite retries
      this.logger.warn('Gmail promotion failed', {
        apiLogId: payload.apiLogId,
        userId: payload.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Handle Calendar event promotion event
   * This runs asynchronously in the job queue after the API log has been marked as processed
   * Promotes calendar events to the events table and creates person entities
   */
  @OnEvent(Events.PROMOTE_CALENDAR_EVENTS)
  async handlePromoteCalendarEvents(payload: EventPayloads[Events.PROMOTE_CALENDAR_EVENTS]) {
    this.logger.log('Processing Calendar promotion job', {
      apiLogId: payload.apiLogId,
      userId: payload.userId,
    });

    try {
      await this.calendarPromotionService.promoteCalendarEvents(
        payload.content,
        payload.userId,
        payload.connectionId,
      );

      this.logger.log('Calendar promotion completed successfully', {
        apiLogId: payload.apiLogId,
      });
    } catch (error) {
      // Log as warning - job will complete anyway to avoid infinite retries
      this.logger.warn('Calendar promotion failed', {
        apiLogId: payload.apiLogId,
        userId: payload.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
}
