import PgBoss from 'pg-boss';
import type { Application } from '../configuration/types';
import { Logger } from '../utils';
import { EnhancedAIHandler } from '../handlers/enhanced-ai-handlers';
import ollama from 'ollama';

// Types matching the enhanced AI handlers
interface AnalysisOptions {
  includeDetails?: boolean;
  categories?: string[];
  maxSentences?: number;
  maxKeywords?: number;
}

interface AnalysisJob {
  data: {
    content: string;
    analysisType: string;
    options?: AnalysisOptions;
  };
}

interface EmbeddingJob {
  data: {
    text?: string;
    texts?: string[];
    model?: string;
    metadata?: unknown;
  };
}

interface PipelineJob {
  data: {
    step: string;
    data: unknown;
    pipelineId?: string;
    stepIndex: number;
    totalSteps: number;
    nextStep?: string;
  };
}

interface BatchJob {
  data: {
    batchId: string;
    batchIndex: number;
    totalBatches: number;
    items: unknown[];
    processingType: string;
  };
}

interface LLMJob {
  data: {
    operation: 'generate' | 'chat';
    model: string;
    prompt?: string;
    messages?: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
    }>;
    system?: string;
    stream?: boolean;
    format?: string;
    options?: {
      temperature?: number;
      top_p?: number;
      top_k?: number;
      num_predict?: number;
      seed?: number;
    };
  };
}

export interface JobData {
  [key: string]: unknown;
  type?: string;
  content?: string;
  analysisType?: string;
  text?: string;
  texts?: string[];
  model?: string;
  metadata?: unknown;
  options?: unknown;
  // Pipeline job properties
  step?: string;
  data?: unknown;
  pipelineId?: string;
  stepIndex?: number;
  totalSteps?: number;
  nextStep?: string;
  // Batch job properties
  batchId?: string;
  batchIndex?: number;
  totalBatches?: number;
  items?: unknown[];
  processingType?: string;
  // LLM job properties
  operation?: 'generate' | 'chat';
  prompt?: string;
  messages?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  system?: string;
  stream?: boolean;
  format?: string;
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

export interface PgBossJob {
  id: string;
  name: string;
  data: JobData;
  done?: (err?: Error | null, result?: unknown) => void;
}

export interface JobHandler {
  (job: PgBossJob): Promise<void> | void;
}

export interface PostgreSQLConfig {
  connection?: {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    password?: string;
  };
}

export class JobQueueService {
  private boss: PgBoss;
  private isStarted = false;
  private logger = Logger.create('JobQueueService');
  private enhancedAIHandler: EnhancedAIHandler;

  constructor(private app: Application) {
    const config = this.app.get('postgresql') as PostgreSQLConfig;

    // Initialize enhanced AI handler
    this.enhancedAIHandler = new EnhancedAIHandler(app);

    // Create PgBoss instance with the same database connection
    this.boss = new PgBoss({
      host: config?.connection?.host || 'localhost',
      port: config?.connection?.port || 5432,
      database: config?.connection?.database,
      user: config?.connection?.user,
      password: config?.connection?.password,
      // Optional: Configure additional PgBoss settings
      retryLimit: 3,
      retryDelay: 1000,
      expireInHours: 12, // Must be less than 24 hours for PgBoss v10+
      deleteAfterHours: 24, // Also reduced to be reasonable
      max: 10, // maxPoolSize equivalent
    });

    // Handle PgBoss events
    this.boss.on('error', (error: Error) => {
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
  async sendJob(queue: string, data: JobData, options: JobOptions = {}): Promise<string | null> {
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
    options: JobOptions = {},
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
  async registerHandler(queue: string, handler: JobHandler): Promise<void> {
    if (!this.isStarted) {
      throw new Error('JobQueueService is not started');
    }

    try {
      // Use the correct PgBoss work method signature - handler receives array of jobs
      await this.boss.work(queue, async (jobs: PgBossJob[]) => {
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
  async getJob(id: string): Promise<unknown | null> {
    if (!this.isStarted) {
      throw new Error('JobQueueService is not started');
    }

    // PgBoss v10+ API - need to provide queue name, but we'll try to get by ID
    // Note: This is a limitation - we'd need to track queue names or use different approach
    this.logger.warn(`Job retrieval by ID ${id} not implemented - requires queue name`);
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
            result = await this.enhancedAIHandler.processEmbedding(this.transformToEmbeddingJob(job));
            break;
          case 'analysis':
            result = await this.enhancedAIHandler.processAnalysis(this.transformToAnalysisJob(job));
            break;
          default:
            // Legacy support for old job format
            if (job.data.type === 'embedding') {
              result = await this.enhancedAIHandler.processEmbedding(this.transformToEmbeddingJob(job));
            } else if (job.data.type === 'analysis') {
              result = await this.enhancedAIHandler.processAnalysis(this.transformToAnalysisJob(job));
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
        const result = await this.enhancedAIHandler.processPipeline(this.transformToPipelineJob(job));
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
        const result = await this.enhancedAIHandler.processBatch(this.transformToBatchJob(job));
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
        const result = await this.enhancedAIHandler.processAnalysis(this.transformToAnalysisJob(job));
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
      await new Promise((resolve) => setTimeout(resolve, processingTime));

      this.logger.info(`Load test job ${job.id} completed in ${processingTime}ms`);
    });

    await this.registerHandler('stress-test', async (job) => {
      this.logger.info(`Processing stress test job ${job.id}`);

      // Simulate heavier processing for stress testing
      const processingTime = Math.random() * 3000 + 500;
      await new Promise((resolve) => setTimeout(resolve, processingTime));

      // Occasionally fail to test error handling
      if (Math.random() < 0.05) {
        throw new Error('Simulated stress test failure');
      }

      this.logger.info(`Stress test job ${job.id} completed in ${processingTime}ms`);
    });

    // LLM Processing Queue - For Ollama model interactions
    await this.registerHandler('llm-processing', async (job) => {
      this.logger.info(`Processing LLM job ${job.id} with operation: ${job.data.operation}`);

      try {
        const result = await this.processLLMJob(this.transformToLLMJob(job));
        this.logger.info(`LLM job ${job.id} completed:`, result);
      } catch (error) {
        this.logger.error(`LLM job ${job.id} failed:`, error);
        throw error;
      }
    });
  }

  /**
   * Process embedding generation jobs (legacy support)
   */
  private async processEmbeddingJob(data: JobData): Promise<void> {
    // Transform JobData to EmbeddingJob format expected by handler
    const embeddingJob = {
      data: {
        text: data.text as string,
        texts: data.texts as string[],
        model: (data.model as string) || 'nomic-embed-text',
        metadata: data.metadata,
      },
    };
    await this.enhancedAIHandler.processEmbedding(embeddingJob);
  }

  /**
   * Process AI analysis jobs (legacy support)
   */
  private async processAnalysisJob(data: JobData): Promise<void> {
    // Transform JobData to AnalysisJob format expected by handler
    const analysisJob = {
      data: {
        content: data.content as string,
        analysisType: data.analysisType as string,
        options: data.options as AnalysisOptions | undefined,
      },
    };
    await this.enhancedAIHandler.processAnalysis(analysisJob);
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
   * Process LLM jobs using Ollama
   */
  private async processLLMJob(llmJob: LLMJob): Promise<unknown> {
    this.logger.info('Processing LLM job:', llmJob.data);

    try {
      if (llmJob.data.operation === 'generate') {
        if (!llmJob.data.prompt) {
          throw new Error('Prompt is required for generate operation');
        }

        // Force non-streaming for job processing
        const response = await ollama.generate({
          model: llmJob.data.model,
          prompt: llmJob.data.prompt,
          system: llmJob.data.system,
          format: llmJob.data.format,
          options: llmJob.data.options,
          stream: false,
        });

        return {
          success: true,
          operation: 'generate',
          model: llmJob.data.model,
          response: response.response,
          model_info: {
            total_duration: response.total_duration,
            load_duration: response.load_duration,
            prompt_eval_count: response.prompt_eval_count,
            eval_count: response.eval_count,
          },
          completedAt: new Date().toISOString(),
        };
      } else if (llmJob.data.operation === 'chat') {
        if (!llmJob.data.messages || llmJob.data.messages.length === 0) {
          throw new Error('Messages are required for chat operation');
        }

        // Force non-streaming for job processing
        const response = await ollama.chat({
          model: llmJob.data.model,
          messages: llmJob.data.messages,
          format: llmJob.data.format,
          options: llmJob.data.options,
          stream: false,
        });

        return {
          success: true,
          operation: 'chat',
          model: llmJob.data.model,
          message: response.message,
          model_info: {
            total_duration: response.total_duration,
            load_duration: response.load_duration,
            prompt_eval_count: response.prompt_eval_count,
            eval_count: response.eval_count,
          },
          completedAt: new Date().toISOString(),
        };
      } else {
        throw new Error(`Unknown LLM operation: ${llmJob.data.operation}`);
      }
    } catch (error) {
      this.logger.error('LLM processing error:', error);
      throw error;
    }
  }

  /**
   * Get the underlying PgBoss instance for advanced operations
   */
  getBoss(): unknown {
    return this.boss;
  }

  /**
   * Check if the service is started
   */
  isReady(): boolean {
    return this.isStarted;
  }

  /**
   * Transform PgBossJob to AnalysisJob format expected by enhanced AI handler
   */
  private transformToAnalysisJob(job: PgBossJob): AnalysisJob {
    return {
      data: {
        content: job.data.content as string,
        analysisType: job.data.analysisType as string,
        options: job.data.options as AnalysisOptions | undefined,
      },
    };
  }

  /**
   * Transform PgBossJob to EmbeddingJob format expected by enhanced AI handler
   */
  private transformToEmbeddingJob(job: PgBossJob): EmbeddingJob {
    return {
      data: {
        text: job.data.text as string | undefined,
        texts: job.data.texts as string[] | undefined,
        model: job.data.model as string | undefined,
        metadata: job.data.metadata,
      },
    };
  }

  /**
   * Transform PgBossJob to PipelineJob format expected by enhanced AI handler
   */
  private transformToPipelineJob(job: PgBossJob): PipelineJob {
    return {
      data: {
        step: job.data.step as string,
        data: job.data.data,
        pipelineId: job.data.pipelineId as string | undefined,
        stepIndex: job.data.stepIndex as number,
        totalSteps: job.data.totalSteps as number,
        nextStep: job.data.nextStep as string | undefined,
      },
    };
  }

  /**
   * Transform PgBossJob to BatchJob format expected by enhanced AI handler
   */
  private transformToBatchJob(job: PgBossJob): BatchJob {
    return {
      data: {
        batchId: job.data.batchId as string,
        batchIndex: job.data.batchIndex as number,
        totalBatches: job.data.totalBatches as number,
        items: job.data.items as unknown[],
        processingType: job.data.processingType as string,
      },
    };
  }

  /**
   * Transform PgBossJob to LLMJob format for LLM processing
   */
  private transformToLLMJob(job: PgBossJob): LLMJob {
    return {
      data: {
        operation: job.data.operation as 'generate' | 'chat',
        model: job.data.model as string,
        prompt: job.data.prompt as string | undefined,
        messages: job.data.messages as Array<{
          role: 'user' | 'assistant' | 'system';
          content: string;
        }> | undefined,
        system: job.data.system as string | undefined,
        stream: job.data.stream as boolean | undefined,
        format: job.data.format as string | undefined,
        options: job.data.options as {
          temperature?: number;
          top_p?: number;
          top_k?: number;
          num_predict?: number;
          seed?: number;
        } | undefined,
      },
    };
  }
}

export default JobQueueService;
