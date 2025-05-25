const PgBoss = require('pg-boss');
import type { Application } from '../configuration/types';
import { Logger } from '../utils';
import { EnhancedAIHandler } from '../handlers/enhanced-ai-handlers';

export interface JobData {
  [key: string]: any;
}

export interface JobOptions {
  priority?: number;
  delay?: number;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireIn?: string;
  startAfter?: string | Date;
  singletonKey?: string;
  singletonSeconds?: number;
}

export class JobQueueService {
  private boss: any;
  private isStarted = false;
  private logger = Logger.create('JobQueueService');
  private enhancedAIHandler: EnhancedAIHandler;

  constructor(private app: Application) {
    const config = this.app.get('postgresql');

    // Initialize enhanced AI handler
    this.enhancedAIHandler = new EnhancedAIHandler(app);

    // Create PgBoss instance with the same database connection
    this.boss = new PgBoss({
      host: (config as any)?.connection?.host || 'localhost',
      port: (config as any)?.connection?.port || 5432,
      database: (config as any)?.connection?.database,
      user: (config as any)?.connection?.user,
      password: (config as any)?.connection?.password,
      // Optional: Configure additional PgBoss settings
      retryLimit: 3,
      retryDelay: 1000,
      expireInHours: 12, // Must be less than 24 hours for PgBoss v10+
      deleteAfterHours: 24, // Also reduced to be reasonable
      max: 10, // maxPoolSize equivalent
    });

    // Handle PgBoss events
    this.boss.on('error', (error: any) => {
      this.logger.error('PgBoss error:', error);
    });

    this.boss.on('maintenance', () => {
      this.logger.info('PgBoss maintenance completed');
    });
  }

  /**
   * Start the job queue service
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn('JobQueueService is already started');
      return;
    }

    try {
      await this.boss.start();
      this.isStarted = true;
      this.logger.info('JobQueueService started successfully');

      // Register default job handlers
      await this.registerDefaultHandlers();
    } catch (error) {
      this.logger.error('Failed to start JobQueueService:', error);
      throw error;
    }
  }

  /**
   * Stop the job queue service
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    try {
      await this.boss.stop();
      this.isStarted = false;
      this.logger.info('JobQueueService stopped successfully');
    } catch (error) {
      this.logger.error('Failed to stop JobQueueService:', error);
      throw error;
    }
  }

  /**
   * Send a job to the queue
   */
  async sendJob(
    queue: string,
    data: JobData,
    options: JobOptions = {}
  ): Promise<string | null> {
    if (!this.isStarted) {
      throw new Error('JobQueueService is not started');
    }

    try {
      const jobId = await this.boss.send(queue, data, options);
      this.logger.info(`Job ${jobId} sent to queue ${queue}`);
      return jobId;
    } catch (error) {
      this.logger.error(`Failed to send job to queue ${queue}:`, error);
      throw error;
    }
  }

  /**
   * Schedule a job with cron expression
   */
  async scheduleJob(
    name: string,
    cronExpression: string,
    data: JobData = {},
    options: JobOptions = {}
  ): Promise<void> {
    if (!this.isStarted) {
      throw new Error('JobQueueService is not started');
    }

    try {
      // In PgBoss v10+, we need to use send with a startAfter date for scheduling
      // For cron-based scheduling, we'll use the schedule method but might need to
      // register a handler first or use a different approach
      await this.boss.schedule(name, cronExpression, data, {
        ...options,
        priority: options.priority || 0,
      });
      this.logger.info(`Job ${name} scheduled with cron: ${cronExpression}`);
    } catch (error) {
      this.logger.error(`Failed to schedule job ${name}:`, error);

      // Fallback: try to send a delayed job instead
      try {
        const now = new Date();
        const delay = 60000; // 1 minute delay as fallback
        await this.boss.send(name, data, {
          ...options,
          startAfter: new Date(now.getTime() + delay),
        });
        this.logger.info(`Fallback: Job ${name} sent with delay instead of cron schedule`);
      } catch (fallbackError) {
        this.logger.error(`Fallback also failed for job ${name}:`, fallbackError);
        throw error; // throw original error
      }
    }
  }

  /**
   * Register a job handler
   */
  async registerHandler(
    queue: string,
    handler: (job: any) => Promise<void> | void,
    options: any = {}
  ): Promise<void> {
    if (!this.isStarted) {
      throw new Error('JobQueueService is not started');
    }

    try {
      await this.boss.work(queue, options, async (jobs: any[]) => {
        for (const job of jobs) {
          try {
            await handler(job);
            this.logger.info(`Job ${job.id} from queue ${queue} completed successfully`);
          } catch (error) {
            this.logger.error(`Job ${job.id} from queue ${queue} failed:`, error);
            throw error; // This will cause the job to be retried or moved to failed queue
          }
        }
      });
      this.logger.info(`Handler registered for queue: ${queue}`);
    } catch (error) {
      this.logger.error(`Failed to register handler for queue ${queue}:`, error);
      throw error;
    }
  }

  /**
   * Get job by ID
   */
  async getJob(id: string): Promise<any | null> {
    if (!this.isStarted) {
      throw new Error('JobQueueService is not started');
    }

    // PgBoss v10+ API - need to provide queue name, but we'll try to get by ID
    // Note: This is a limitation - we'd need to track queue names or use different approach
    return null; // TODO: Implement proper job retrieval
  }

  /**
   * Cancel a job
   */
  async cancelJob(queueName: string, id: string): Promise<void> {
    if (!this.isStarted) {
      throw new Error('JobQueueService is not started');
    }

    await this.boss.cancel(queueName, id);
    this.logger.info(`Job ${id} cancelled`);
  }

  /**
   * Resume a job
   */
  async resumeJob(queueName: string, id: string): Promise<void> {
    if (!this.isStarted) {
      throw new Error('JobQueueService is not started');
    }

    await this.boss.resume(queueName, id);
    this.logger.info(`Job ${id} resumed`);
  }

  /**
   * Get queue size
   */
  async getQueueSize(queue: string): Promise<number> {
    if (!this.isStarted) {
      throw new Error('JobQueueService is not started');
    }

    const result = await this.boss.getQueueSize(queue);
    return result || 0;
  }

  /**
   * Register default job handlers for common AI tasks
   */
  private async registerDefaultHandlers(): Promise<void> {
    // AI Processing Queue - Enhanced with realistic AI operations
    await this.registerHandler('ai-processing', async (job) => {
      this.logger.info(`Processing AI job ${job.id} of type: ${job.data.type}`);

      try {
        let result;

        switch (job.data.type) {
          case 'embedding':
            result = await this.enhancedAIHandler.processEmbedding(job);
            break;
          case 'analysis':
            result = await this.enhancedAIHandler.processAnalysis(job);
            break;
          default:
            // Legacy support for old job format
            if (job.data.type === 'embedding') {
              result = await this.enhancedAIHandler.processEmbedding(job);
            } else if (job.data.type === 'analysis') {
              result = await this.enhancedAIHandler.processAnalysis(job);
            } else {
              this.logger.warn(`Unknown AI job type: ${job.data.type}`);
              result = { success: false, error: 'Unknown job type' };
            }
        }

        this.logger.info(`AI job ${job.id} completed:`, result);
      } catch (error) {
        this.logger.error(`AI job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Pipeline Processing Queue - For complex multi-step AI workflows
    await this.registerHandler('pipeline', async (job) => {
      this.logger.info(`Processing pipeline job ${job.id}`);

      try {
        const result = await this.enhancedAIHandler.processPipeline(job);
        this.logger.info(`Pipeline job ${job.id} completed:`, result);
      } catch (error) {
        this.logger.error(`Pipeline job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Batch Processing Queue - For handling large datasets
    await this.registerHandler('batch-processing', async (job) => {
      this.logger.info(`Processing batch job ${job.id}`);

      try {
        const result = await this.enhancedAIHandler.processBatch(job);
        this.logger.info(`Batch job ${job.id} completed:`, result);
      } catch (error) {
        this.logger.error(`Batch job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Multi-Model Processing Queue
    await this.registerHandler('multi-model', async (job) => {
      this.logger.info(`Processing multi-model job ${job.id}`);

      try {
        const result = await this.enhancedAIHandler.processAnalysis(job);
        this.logger.info(`Multi-model job ${job.id} completed:`, result);
      } catch (error) {
        this.logger.error(`Multi-model job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Notification Queue - Enhanced with better handling
    await this.registerHandler('notifications', async (job) => {
      this.logger.info(`Processing notification job ${job.id}`);

      try {
        await this.processNotificationJob(job.data);
      } catch (error) {
        this.logger.error(`Notification job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Data Processing Queue - Enhanced
    await this.registerHandler('data-processing', async (job) => {
      this.logger.info(`Processing data job ${job.id}`);

      try {
        await this.processDataJob(job.data);
      } catch (error) {
        this.logger.error(`Data job ${job.id} failed:`, error);
        throw error;
      }
    });

    // Load Testing and Performance Queues
    await this.registerHandler('load-test', async (job) => {
      this.logger.info(`Processing load test job ${job.id}`);

      // Simulate varying processing times for load testing
      const processingTime = Math.random() * 1000 + 100;
      await new Promise(resolve => setTimeout(resolve, processingTime));

      this.logger.info(`Load test job ${job.id} completed in ${processingTime}ms`);
    });

    await this.registerHandler('stress-test', async (job) => {
      this.logger.info(`Processing stress test job ${job.id}`);

      // Simulate heavier processing for stress testing
      const processingTime = Math.random() * 3000 + 500;
      await new Promise(resolve => setTimeout(resolve, processingTime));

      // Occasionally fail to test error handling
      if (Math.random() < 0.05) {
        throw new Error('Simulated stress test failure');
      }

      this.logger.info(`Stress test job ${job.id} completed in ${processingTime}ms`);
    });
  }

  /**
   * Process embedding generation jobs (legacy support)
   */
  private async processEmbeddingJob(data: JobData): Promise<void> {
    // Delegate to enhanced handler
    await this.enhancedAIHandler.processEmbedding({ data });
  }

  /**
   * Process AI analysis jobs (legacy support)
   */
  private async processAnalysisJob(data: JobData): Promise<void> {
    // Delegate to enhanced handler
    await this.enhancedAIHandler.processAnalysis({ data });
  }

  /**
   * Process notification jobs
   */
  private async processNotificationJob(data: JobData): Promise<void> {
    // TODO: Implement notification sending
    this.logger.info('Processing notification job:', data);

    // Example: Send email, push notification, etc.
  }

  /**
   * Process data processing jobs
   */
  private async processDataJob(data: JobData): Promise<void> {
    // TODO: Implement data processing logic
    this.logger.info('Processing data job:', data);

    // Example: Data transformation, cleanup, analysis, etc.
  }

  /**
   * Get the underlying PgBoss instance for advanced operations
   */
  getBoss(): any {
    return this.boss;
  }

  /**
   * Check if the service is started
   */
  isReady(): boolean {
    return this.isStarted;
  }
}

export default JobQueueService;
