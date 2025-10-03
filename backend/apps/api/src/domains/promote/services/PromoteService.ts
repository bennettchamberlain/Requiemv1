import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import type { RequestContext } from '@ci/common/types';

import { ApiLogEntity } from '../../etl/entities/ApiLogEntity';

import { GoogleCalendarEventPromotionService } from './CalendarPromotionService';
import { GmailPromotionService } from './GmailPromotionService';

@Injectable()
export class PromoteService {
  private logger = new LoggerService(PromoteService.name);

  constructor(
    @InjectRepository(ApiLogEntity)
    private readonly calendarEventPromotionService: GoogleCalendarEventPromotionService,
    private readonly gmailPromotionService: GmailPromotionService,
    private readonly apiLogRepository: Repository<ApiLogEntity>,
  ) {}

  /**
   * Main entry point for PromoteService
   */
  async promoteApiLogs(context: RequestContext): Promise<void> {
    this.logger.log('Starting promote api logs', {
      userId: context.userId,
    });

    try {
      const unprocessedApiLogs = await this.apiLogRepository.find({
        where: {
          user_id: context.userId,
          last_processed: IsNull(),
        },
        order: {
          created_at: 'ASC',
        },
        take: 100,
      });

      this.logger.log('Found unprocessed API logs', {
        userId: context.userId,
        count: unprocessedApiLogs.length,
      });

      if (unprocessedApiLogs.length === 0) {
        this.logger.log('No unprocessed API logs found', {
          userId: context.userId,
        });

        return;
      }

      // Process each API log
      for (const apiLog of unprocessedApiLogs) {
        await this.processApiLog(apiLog, context);
      }

      this.logger.log('Completed processing API logs', {
        userId: context.userId,
        processedCount: unprocessedApiLogs.length,
      });
    } catch (error) {
      this.logger.error('Error in promoteApiLogs', {
        userId: context.userId,
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

      if (apiLog.scope === 'Gmail') {
        await this.gmailPromotionService.promoteGmailMessages(
          apiLog.content,
          context.userId,
          apiLog.connection_id,
        );
      } else if (apiLog.scope === 'Google Calendar') {
        await this.calendarEventPromotionService.promoteCalendarEvents(
          apiLog.content,
          context.userId,
          apiLog.connection_id,
        );
      }

      // Mark the API log as processed
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
