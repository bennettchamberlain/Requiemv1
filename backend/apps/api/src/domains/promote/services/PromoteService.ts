import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, MoreThan, Not } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';
import { Events, EventService } from '@ci/domains/events';

import { ConnectionEntity } from '../../connections/entities/ConnectionEntity';
import { ApiLogEntity } from '../../etl/entities/ApiLogEntity';

@Injectable()
export class PromoteService {
  private logger = new LoggerService(PromoteService.name);

  constructor(
    @InjectRepository(ApiLogEntity)
    private readonly apiLogRepository: Repository<ApiLogEntity>,
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
    private readonly eventService: EventService,
  ) {}

  /**
   * Promote API logs for a specific user
   */
  async promoteApiLogs(userId: string): Promise<void> {
    this.logger.log('Starting promote api logs for user', {
      userId,
    });

    try {
      const unprocessedApiLogs = await this.apiLogRepository
        .createQueryBuilder('apiLog')
        .innerJoin('apiLog.connection', 'connection')
        .where('apiLog.user_id = :userId', { userId })
        .andWhere('apiLog.last_processed IS NULL')
        .andWhere('apiLog.connection_id IS NOT NULL')
        .andWhere('connection.active = true')
        .andWhere('connection.access_token IS NOT NULL')
        .andWhere('connection.token_expiry > :currentDate', { currentDate: new Date() })
        .orderBy('apiLog.created_at', 'ASC')
        .limit(1)
        .getMany();

      this.logger.log('Found unprocessed API logs', {
        userId,
        count: unprocessedApiLogs.length,
      });

      if (unprocessedApiLogs.length === 0) {
        this.logger.log('No unprocessed API logs found', {
          userId,
        });

        return;
      }

      // Process each API log
      for (const apiLog of unprocessedApiLogs) {
        await this.processApiLog(apiLog, { userId } as RequestContext);
      }

      this.logger.log('Completed processing API logs', {
        userId,
        processedCount: unprocessedApiLogs.length,
      });
    } catch (error) {
      this.logger.error('Error in promoteApiLogsForUser', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Process a single API log entry
   */
  private async processApiLog(apiLog: ApiLogEntity, context: RequestContext): Promise<void> {
    this.logger.log('Processing API log', {
      apiLogId: apiLog.id,
      scope: apiLog.scope,
      userId: context.userId,
    });

    try {
      if (!context.userId) {
        this.logger.error('User ID is required', {
          apiLogId: apiLog.id,
        });

        return;
      }

      if (!apiLog.connection_id) {
        this.logger.error('Connection ID is required', {
          apiLogId: apiLog.id,
        });

        return;
      }

      const connection = await this.connectionRepository.findOne({
        where: {
          id: apiLog.connection_id,
          active: true,
          accessToken: Not(IsNull()),
          tokenExpiry: MoreThan(new Date()),
        },
      });

      if (!connection) {
        this.logger.warn('Connection is not active or has invalid tokens, skipping API log processing', {
          apiLogId: apiLog.id,
          connectionId: apiLog.connection_id,
        });

        // TODO: Should we mark as processed to avoid reprocessing or handle refreshing the connection?
        // Currently marking as processed to avoid reprocessing connections with invalid tokens
        await this.markApiLogAsProcessed(apiLog.id);

        return;
      }

      // Queue the promotion job based on scope
      if (apiLog.scope === 'Gmail') {
        await this.eventService.send(Events.PROMOTE_GMAIL_MESSAGES, {
          apiLogId: apiLog.id,
          userId: context.userId,
          connectionId: apiLog.connection_id,
          content: apiLog.content,
        });
      } else if (apiLog.scope === 'Google Calendar') {
        await this.eventService.send(Events.PROMOTE_CALENDAR_EVENTS, {
          apiLogId: apiLog.id,
          userId: context.userId,
          connectionId: apiLog.connection_id,
          content: apiLog.content,
        });
      } else if (apiLog.scope === 'YouTube') {
        await this.eventService.send(Events.PROMOTE_YOUTUBE_DATA, {
          apiLogId: apiLog.id,
          userId: context.userId,
          connectionId: apiLog.connection_id,
          content: apiLog.content,
        });
      } else if (apiLog.scope === 'Google Drive') {
        await this.eventService.send(Events.PROMOTE_DRIVE_DATA, {
          apiLogId: apiLog.id,
          userId: context.userId,
          connectionId: apiLog.connection_id,
          content: apiLog.content,
        });
      } else if (apiLog.scope === 'Google Contacts') {
        await this.eventService.send(Events.PROMOTE_CONTACTS, {
          apiLogId: apiLog.id,
          userId: context.userId,
          connectionId: apiLog.connection_id,
          content: apiLog.content,
        });
      }

      // Mark the API log as processed after queuing
      await this.markApiLogAsProcessed(apiLog.id);

      this.logger.log('Successfully processed API log', {
        apiLogId: apiLog.id,
        scope: apiLog.scope,
      });
    } catch (error) {
      this.logger.error('Error processing API log', {
        apiLogId: apiLog.id,
        scope: apiLog.scope,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Mark an API log as processed
   */
  private async markApiLogAsProcessed(apiLogId: string): Promise<void> {
    await this.apiLogRepository.update(apiLogId, {
      last_processed: new Date(),
    });
  }
}
