import { Controller } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';

import { FeatureService } from '@ci/common/feature';
import { LoggerService } from '@ci/common/logging';
import { Cron } from '@ci/common/schedule';
import { ApiLogEntity } from '@ci/domains/etl';
import { EventPayloads, Events, OnEvent } from '@ci/domains/events';

import { GoogleCalendarEventPromotionService } from '../../services/google/CalendarPromotionService';
import { ContactsPromotionService } from '../../services/google/ContactsPromotionService';
import { DrivePromotionService } from '../../services/google/DrivePromotionService';
import { GmailPromotionService } from '../../services/google/GmailPromotionService';
import { YouTubePromotionService } from '../../services/google/YouTubePromotionService';
import { PromoteService } from '../../services/PromoteService';

@Controller('promote')
export class PromoteController {
  constructor(
    private readonly promoteService: PromoteService,
    private readonly gmailPromotionService: GmailPromotionService,
    private readonly calendarPromotionService: GoogleCalendarEventPromotionService,
    private readonly youtubePromotionService: YouTubePromotionService,
    private readonly drivePromotionService: DrivePromotionService,
    private readonly contactsPromotionService: ContactsPromotionService,
    @InjectRepository(ApiLogEntity)
    private readonly apiLogRepository: Repository<ApiLogEntity>,
    private readonly logger: LoggerService,
    private readonly featureService: FeatureService,
  ) {
    this.logger.setContext(PromoteController.name);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async promoteApiLogs(): Promise<void> {
    const featureEnabled = await this.featureService.isFeatureEnabled('scheduled.entity.promotion');

    if (!featureEnabled) {
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
        .andWhere(
          new Brackets((qb) => {
            qb.where('connection.token_expiry > :currentDate', { currentDate: new Date() }).orWhere(
              'connection.refresh_token IS NOT NULL',
              { currentDate: new Date() },
            );
          }),
        )
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

  /**
   * Handle YouTube data promotion event
   * This runs asynchronously in the job queue after the API log has been marked as processed
   * Promotes YouTube likes, playlists, subscriptions, and activities to content and entities tables
   */
  @OnEvent(Events.PROMOTE_YOUTUBE_DATA)
  async handlePromoteYouTubeData(payload: EventPayloads[Events.PROMOTE_YOUTUBE_DATA]) {
    this.logger.log('Processing YouTube promotion job', {
      apiLogId: payload.apiLogId,
      userId: payload.userId,
    });

    try {
      await this.youtubePromotionService.promoteYouTubeData(
        payload.content,
        payload.userId,
        payload.connectionId,
      );

      this.logger.log('YouTube promotion completed successfully', {
        apiLogId: payload.apiLogId,
      });
    } catch (error) {
      // Log as warning - job will complete anyway to avoid infinite retries
      this.logger.warn('YouTube promotion failed', {
        apiLogId: payload.apiLogId,
        userId: payload.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Handle Drive data promotion event
   * This runs asynchronously in the job queue after the API log has been marked as processed
   * Promotes Google Drive files to content, documents, and entities tables
   */
  @OnEvent(Events.PROMOTE_DRIVE_DATA)
  async handlePromoteDriveData(payload: EventPayloads[Events.PROMOTE_DRIVE_DATA]) {
    this.logger.log('Processing Drive promotion job', {
      apiLogId: payload.apiLogId,
      userId: payload.userId,
    });

    try {
      await this.drivePromotionService.promoteDriveData(
        payload.content,
        payload.userId,
        payload.connectionId,
      );

      this.logger.log('Drive promotion completed successfully', {
        apiLogId: payload.apiLogId,
      });
    } catch (error) {
      // Log as warning - job will complete anyway to avoid infinite retries
      this.logger.warn('Drive promotion failed', {
        apiLogId: payload.apiLogId,
        userId: payload.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * Handle Contacts promotion event
   * This runs asynchronously in the job queue after the API log has been marked as processed
   * Promotes Google Contacts to entities table with KNOWS relationships
   */
  @OnEvent(Events.PROMOTE_CONTACTS)
  async handlePromoteContacts(payload: EventPayloads[Events.PROMOTE_CONTACTS]) {
    this.logger.log('Processing Contacts promotion job', {
      apiLogId: payload.apiLogId,
      userId: payload.userId,
    });

    try {
      await this.contactsPromotionService.promoteContacts(
        payload.content,
        payload.userId,
        payload.connectionId,
      );

      this.logger.log('Contacts promotion completed successfully', {
        apiLogId: payload.apiLogId,
      });
    } catch (error) {
      // Log as warning - job will complete anyway to avoid infinite retries
      this.logger.warn('Contacts promotion failed', {
        apiLogId: payload.apiLogId,
        userId: payload.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }
}
