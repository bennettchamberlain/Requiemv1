import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import PgBoss from 'pg-boss';

import config from '@ci/config';
import { LoggerService } from '@ci/common/services';

export enum Queue {
  DEFAULT = 'default',
}

@Injectable()
export class DelegationService implements OnModuleInit, OnModuleDestroy {
  private logger = new LoggerService(DelegationService.name);

  private boss = new PgBoss({
    connectionString: config.db.url,
    schema: 'pgboss',
    // Optional PgBoss settings
    retryLimit: 3,
    retryDelay: 1000,
    expireInHours: 12, // Must be less than 24 hours for PgBoss v10+
    deleteAfterHours: 24, // Also reduced to be reasonable
    max: 10, // maxPoolSize equivalent
  });

  constructor() {}

  async onModuleInit() {
    try {
      await this.boss.start();
      this.logger.log('Initialized PgBoss client');
    } catch (error: unknown) {
      this.logger.error('Failed to initialize PgBoss client', error as Error);
      throw error;
    }

    this.boss.on('error', (err) => {
      this.logger.error('PgBoss error', err);
    });

    await this.boss.createQueue(Queue.DEFAULT);

    await this.boss.work(Queue.DEFAULT, async ([job]) => {
      this.logger.log('Job processed', {
        id: job.id,
        name: job.name,
        expireInSeconds: job.expireInSeconds,
        data: job.data,
      });
    });
  }

  async onModuleDestroy() {
    try {
      await this.boss.stop();
      this.logger.log('Stopped PgBoss client');
    } catch (error: unknown) {
      this.logger.error('Failed to stop PgBoss client', error as Error);
      throw error;
    }
  }

  async sendEvent<D extends object>(data: D, options?: { queue?: Queue }): Promise<string | null> {
    const resolvedOptions = options ?? {
      queue: Queue.DEFAULT,
    };

    const { queue } = resolvedOptions;
    const resolvedQueue = queue ?? Queue.DEFAULT;

    return this.boss.send(resolvedQueue, data);
  }
}
