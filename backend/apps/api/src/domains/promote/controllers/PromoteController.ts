import { Controller } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { LoggerService } from '@ci/common/services';
import config from '@ci/configuration';

import { ConnectionEntity } from '../../connections/entities/ConnectionEntity';
import { ApiLogEntity } from '../../etl/entities/ApiLogEntity';
import { PromoteService } from '../services/PromoteService';

@Controller('promote')
export class PromoteController {
  private logger = new LoggerService(PromoteController.name);

  constructor(
    private readonly promoteService: PromoteService,
    @InjectRepository(ApiLogEntity)
    private readonly apiLogRepository: Repository<ApiLogEntity>,
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
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
}
