// Enhanced usage examples and patterns for the Job Queue System
// filepath: /Users/williambroza/devel/CI-Server/backend/apps/api/src/examples/advanced-job-examples.ts

import { queueAIJob, queueNotification, queueDataProcessing, getJobQueue } from '../utils/job-queue-utils';
import type { Application } from '../configuration/types';

/**
 * Advanced Pattern: Pipeline Processing
 * Chain multiple AI jobs together where one job triggers the next
 */
export async function createAIPipeline(
  app: Application,
  inputData: any,
  steps: string[]
): Promise<string[]> {
  const jobIds: string[] = [];
  let currentData = inputData;

  for (const [index, step] of steps.entries()) {
    const jobId = await queueAIJob(app, 'pipeline', {
      step,
      data: currentData,
      pipelineId: `pipeline-${Date.now()}`,
      stepIndex: index,
      totalSteps: steps.length,
      nextStep: steps[index + 1] || null,
    }, {
      priority: 7,
      retryLimit: 2,
      delay: index * 1000, // Stagger jobs
    });

    if (jobId) {
      jobIds.push(jobId);
    }
  }

  return jobIds;
}

/**
 * Advanced Pattern: Batch Processing with Progress Tracking
 */
export async function processBatchWithProgress(
  app: Application,
  items: any[],
  batchSize: number = 10,
  processingType: string = 'analysis'
): Promise<{ batchId: string; jobIds: string[] }> {
  const batchId = `batch-${Date.now()}`;
  const jobIds: string[] = [];

  // Split items into batches
  const batches = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  // Queue each batch
  for (const [index, batch] of batches.entries()) {
    const jobId = await queueAIJob(app, 'batch-processing', {
      batchId,
      batchIndex: index,
      totalBatches: batches.length,
      items: batch,
      processingType,
    }, {
      priority: 4,
      retryLimit: 3,
      singletonKey: `${batchId}-${index}`, // Prevent duplicate batches
    });

    if (jobId) {
      jobIds.push(jobId);
    }
  }

  return { batchId, jobIds };
}

/**
 * Advanced Pattern: Priority Queue Management
 */
export async function queueWithDynamicPriority(
  app: Application,
  jobData: any,
  userTier: 'free' | 'premium' | 'enterprise'
): Promise<string | null> {
  const priorityMap = {
    free: 2,
    premium: 6,
    enterprise: 9,
  };

  const retryMap = {
    free: 1,
    premium: 3,
    enterprise: 5,
  };

  return await queueAIJob(app, 'priority-processing', {
    ...jobData,
    userTier,
    timestamp: new Date().toISOString(),
  }, {
    priority: priorityMap[userTier],
    retryLimit: retryMap[userTier],
    retryDelay: userTier === 'enterprise' ? 500 : 2000,
  });
}

/**
 * Advanced Pattern: Job Dependencies
 * Queue a job that waits for other jobs to complete
 */
export async function queueDependentJob(
  app: Application,
  jobData: any,
  dependsOn: string[]
): Promise<string | null> {
  return await queueAIJob(app, 'dependent-processing', {
    ...jobData,
    dependencies: dependsOn,
    createdAt: new Date().toISOString(),
  }, {
    priority: 3,
    retryLimit: 2,
    startAfter: new Date(Date.now() + 30000), // Wait 30 seconds
  });
}

/**
 * Advanced Pattern: Streaming/Real-time Job Processing
 */
export async function createStreamingProcessor(
  app: Application,
  streamId: string,
  processingConfig: any
): Promise<string | null> {
  return await queueAIJob(app, 'streaming', {
    streamId,
    config: processingConfig,
    mode: 'real-time',
    bufferSize: 100,
  }, {
    priority: 10,
    retryLimit: 10,
    retryDelay: 100,
    expireIn: '1 hour',
  });
}

/**
 * Advanced Pattern: Scheduled Data Sync with External APIs
 */
export async function scheduleAPISync(
  app: Application,
  apiConfig: {
    endpoint: string;
    method: string;
    headers?: Record<string, string>;
    authentication?: any;
  }
): Promise<void> {
  const jobQueue = getJobQueue(app);

  await jobQueue.schedule(
    'api-sync',
    '*/15 * * * *', // Every 15 minutes
    {
      ...apiConfig,
      syncType: 'external-api',
      lastSync: null,
    },
    {
      priority: 3,
      retryLimit: 3,
      retryDelay: 5000,
    }
  );
}

/**
 * Advanced Pattern: Multi-Model AI Processing
 */
export async function processWithMultipleModels(
  app: Application,
  content: string,
  models: string[]
): Promise<string[]> {
  const jobIds: string[] = [];

  for (const model of models) {
    const jobId = await queueAIJob(app, 'multi-model', {
      content,
      model,
      timestamp: new Date().toISOString(),
    }, {
      priority: 5,
      retryLimit: 2,
      singletonKey: `multi-model-${model}-${Buffer.from(content).toString('base64').slice(0, 10)}`,
    });

    if (jobId) {
      jobIds.push(jobId);
    }
  }

  return jobIds;
}

/**
 * Advanced Pattern: Error Recovery and Circuit Breaker
 */
export async function queueWithCircuitBreaker(
  app: Application,
  jobData: any,
  serviceName: string
): Promise<string | null> {
  const jobQueue = getJobQueue(app);

  // Check if circuit breaker is open for this service
  const circuitState = await jobQueue.getServiceCircuitState?.(serviceName) || 'closed';

  if (circuitState === 'open') {
    throw new Error(`Circuit breaker is open for service: ${serviceName}`);
  }

  return await queueAIJob(app, 'circuit-breaker', {
    ...jobData,
    serviceName,
    circuitState,
  }, {
    priority: 4,
    retryLimit: 1, // Limited retries for circuit breaker pattern
    retryDelay: 5000,
  });
}

/**
 * Advanced Pattern: Job Result Aggregation
 */
export async function aggregateJobResults(
  app: Application,
  jobIds: string[],
  aggregationType: 'merge' | 'average' | 'concat'
): Promise<string | null> {
  return await queueDataProcessing(app, 'aggregation', {
    jobIds,
    aggregationType,
    createdAt: new Date().toISOString(),
  }, {
    priority: 3,
    retryLimit: 2,
    delay: 5000, // Give source jobs time to complete
  });
}

/**
 * Performance Testing: Load Testing Utilities
 */
export class JobQueueLoadTester {
  private app: Application;
  private metrics: {
    jobsQueued: number;
    jobsCompleted: number;
    jobsFailed: number;
    avgQueueTime: number;
    avgProcessingTime: number;
  };

  constructor(app: Application) {
    this.app = app;
    this.metrics = {
      jobsQueued: 0,
      jobsCompleted: 0,
      jobsFailed: 0,
      avgQueueTime: 0,
      avgProcessingTime: 0,
    };
  }

  /**
   * Load test: Queue multiple jobs rapidly
   */
  async loadTestJobCreation(
    jobCount: number,
    concurrency: number = 10,
    jobType: string = 'load-test'
  ): Promise<void> {
    console.log(`Starting load test: ${jobCount} jobs with concurrency ${concurrency}`);

    const startTime = Date.now();
    const promises: Promise<any>[] = [];

    for (let i = 0; i < jobCount; i++) {
      const promise = this.queueLoadTestJob(i, jobType);
      promises.push(promise);

      // Control concurrency
      if (promises.length >= concurrency) {
        await Promise.allSettled(promises.splice(0, concurrency));
      }
    }

    // Wait for remaining jobs
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`Load test completed in ${duration}ms`);
    console.log(`Throughput: ${(jobCount / duration * 1000).toFixed(2)} jobs/second`);
    console.log('Metrics:', this.metrics);
  }

  private async queueLoadTestJob(index: number, jobType: string): Promise<void> {
    try {
      const jobId = await queueAIJob(this.app, jobType, {
        index,
        payload: `test-data-${index}`,
        timestamp: new Date().toISOString(),
      }, {
        priority: Math.floor(Math.random() * 5) + 1,
        retryLimit: 1,
      });

      if (jobId) {
        this.metrics.jobsQueued++;
      }
    } catch (error) {
      this.metrics.jobsFailed++;
      console.error(`Failed to queue job ${index}:`, error);
    }
  }

  /**
   * Monitor queue performance
   */
  async monitorQueuePerformance(durationMs: number = 60000): Promise<any> {
    const jobQueue = getJobQueue(this.app);
    const startTime = Date.now();
    const samples: any[] = [];

    console.log(`Monitoring queue performance for ${durationMs}ms`);

    const interval = setInterval(async () => {
      try {
        const queueSizes = await Promise.all([
          jobQueue.getQueueSize('ai-processing'),
          jobQueue.getQueueSize('notifications'),
          jobQueue.getQueueSize('data-processing'),
        ]);

        samples.push({
          timestamp: new Date().toISOString(),
          queueSizes: {
            'ai-processing': queueSizes[0],
            'notifications': queueSizes[1],
            'data-processing': queueSizes[2],
          },
          totalPending: queueSizes.reduce((sum, size) => sum + size, 0),
        });
      } catch (error) {
        console.error('Error monitoring queue:', error);
      }
    }, 5000);

    // Stop monitoring after duration
    setTimeout(() => {
      clearInterval(interval);
      console.log('Queue monitoring completed');
      console.log('Performance samples:', samples);
    }, durationMs);

    return new Promise(resolve => {
      setTimeout(() => resolve(samples), durationMs);
    });
  }
}

export default {
  createAIPipeline,
  processBatchWithProgress,
  queueWithDynamicPriority,
  queueDependentJob,
  createStreamingProcessor,
  scheduleAPISync,
  processWithMultipleModels,
  queueWithCircuitBreaker,
  aggregateJobResults,
  JobQueueLoadTester,
};
