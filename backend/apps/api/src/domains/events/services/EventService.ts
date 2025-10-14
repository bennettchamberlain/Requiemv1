import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import plimit from 'p-limit';
import PgBoss, { JobWithMetadata } from 'pg-boss';

import { LoggerService } from '@ci/common/services';
import config from '@ci/configuration';

import { type EventPayloads } from '../event-registry';

export enum Queues {
  DEFAULT = 'default',
}

interface EventData {
  name: string;
}

@Injectable()
export class EventService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new LoggerService(EventService.name);

  private semaphore = plimit(10);

  private running = false;

  private stopTask: Promise<void> | null = null;

  private readonly backoffWhenFull = 150;

  private readonly backoffWhenEmpty = 5000;

  private boss = new PgBoss({
    host: config.db.host,
    port: config.db.port,
    database: config.db.database,
    user: config.db.username,
    password: config.db.password,
    schema: 'pgboss',
    // Optional PgBoss settings
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInHours: 12, // Must be less than 24 hours for PgBoss v10+
    deleteAfterHours: 24, // Also reduced to be reasonable
    max: 10, // maxPoolSize equivalent
  });

  constructor(private eventEmitter: EventEmitter2) {}

  async onModuleInit() {
    try {
      this.logger.log('Initializing PgBoss client...');

      await this.boss.start();

      this.logger.log('Initialized PgBoss client');
    } catch (err: unknown) {
      this.logger.error(
        'Failed to initialize PgBoss client',
        err instanceof Error ? err : new Error(String(err)),
      );

      throw err;
    }

    this.boss.on('error', (err) => {
      this.logger.error('PgBoss error', err);
    });

    // For now we're only interested in one queue. We might want to add more if
    // we need certain tasks to run in parallel, with a larger number of workers,
    // or with different characteristics. Measure and improve as needed.
    await this.boss.createQueue(Queues.DEFAULT);

    try {
      this.logger.log('Initializing work queue...');

      this.stopTask = this.work();

      this.logger.log('Initialized work queue');
    } catch (err: unknown) {
      this.logger.error(
        'Failed to initialize work queue client',
        err instanceof Error ? err : new Error(String(err)),
      );

      throw err;
    }
  }

  async onModuleDestroy() {
    try {
      this.logger.log('Flushing work queue...');

      await this.flush();

      this.logger.log('Flushed work queue');
    } catch (err: unknown) {
      this.logger.error('Failed to flush work queue', err instanceof Error ? err : new Error(String(err)));
    }

    try {
      this.logger.log('Stopping PgBoss client...');

      await this.boss.stop();

      this.logger.log('Stopped PgBoss client');
    } catch (err: unknown) {
      this.logger.error('Failed to stop PgBoss client', err instanceof Error ? err : new Error(String(err)));
    }
  }

  async send<E extends keyof EventPayloads>(
    name: E,
    event: EventPayloads[E],
    options?: { queue?: Queues },
  ): Promise<string | null> {
    const resolvedOptions = options ?? {
      queue: Queues.DEFAULT,
    };

    const { queue } = resolvedOptions;
    const resolvedQueue = queue ?? Queues.DEFAULT;

    const resolvedData = {
      ...event,
      name,
    } satisfies EventData;

    return this.boss.send(resolvedQueue, resolvedData);
  }

  private async work(): Promise<void> {
    this.running = true;

    while (this.running) {
      const inFlightJobCount = this.semaphore.activeCount + this.semaphore.pendingCount;
      const available = Math.max(this.semaphore.concurrency - inFlightJobCount, 0);

      if (available === 0) {
        await new Promise((resolve) => setTimeout(resolve, this.backoffWhenFull));
        continue;
      }

      const jobs = await this.boss.fetch<EventData>(Queues.DEFAULT, {
        includeMetadata: true,
        batchSize: available,
      });

      if (jobs.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, this.backoffWhenEmpty));

        continue;
      }

      for (const job of jobs) {
        this.semaphore(async () => {
          try {
            await this.executeJob(job);
            await this.boss.complete(Queues.DEFAULT, job.id);
          } catch (err) {
            this.logger.error('Failed to complete job', err instanceof Error ? err : new Error(String(err)));
            await this.boss.fail(Queues.DEFAULT, job.id);
          }
        });
      }
    }
  }

  private async flush(): Promise<void> {
    this.running = false;

    try {
      await this.stopTask;
    } catch (err: unknown) {
      this.logger.error(err instanceof Error ? err : new Error(String(err)));
    }

    while (this.semaphore.activeCount + this.semaphore.pendingCount > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async executeJob(job: JobWithMetadata<EventData>): Promise<void> {
    return new Promise((resolve, reject) => {
      const { name, ...data } = job.data;

      const resolvedData = {
        ...data,
        jobId: job.id,
      };

      const done = () => resolve(undefined);
      const fail = (reason: unknown) => reject(reason instanceof Error ? reason : new Error(String(reason)));

      if (this.eventEmitter.hasListeners(name)) {
        this.eventEmitter.emit(name, resolvedData, { done, fail });
      } else {
        fail(new Error('No active listeners for job'));
      }
    });
  }
}
