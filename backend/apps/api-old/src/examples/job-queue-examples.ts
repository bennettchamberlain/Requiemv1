// Example usage of the Job Queue Service with AI processing

import { queueAIJob, queueDataProcessing, scheduleAITask } from '../utils/job-queue-utils';
import type { Application } from '../configuration/types';

/**
 * Example: Queue background embedding generation
 */
export async function queueEmbeddingGeneration(
  app: Application,
  text: string,
  metadata?: any
): Promise<string | null> {
  return await queueAIJob(app, 'embedding', {
    text,
    model: 'nomic-embed-text',
    metadata,
  }, {
    priority: 5,
    retryLimit: 3,
    retryDelay: 5000,
  });
}

/**
 * Example: Queue batch embedding processing
 */
export async function queueBatchEmbeddings(
  app: Application,
  texts: string[],
  metadata?: any
): Promise<string | null> {
  return await queueAIJob(app, 'embedding', {
    texts,
    batch: true,
    model: 'nomic-embed-text',
    metadata,
  }, {
    priority: 3,
    retryLimit: 3,
    retryDelay: 10000,
  });
}

/**
 * Example: Queue AI analysis job
 */
export async function queueAIAnalysis(
  app: Application,
  content: string,
  analysisType: 'sentiment' | 'classification' | 'summary',
  options?: any
): Promise<string | null> {
  return await queueAIJob(app, 'analysis', {
    content,
    analysisType,
    options,
  }, {
    priority: 4,
    retryLimit: 2,
    retryDelay: 3000,
  });
}

/**
 * Example: Queue data processing job
 */
export async function queueDataImport(
  app: Application,
  filePath: string,
  importType: 'csv' | 'json' | 'xml',
  options?: any
): Promise<string | null> {
  return await queueDataProcessing(app, 'import', {
    filePath,
    importType,
    options,
  }, {
    priority: 2,
    retryLimit: 1,
    retryDelay: 5000,
  });
}

/**
 * Example: Schedule daily AI maintenance tasks
 */
export async function scheduleMaintenanceTasks(app: Application): Promise<void> {
  // Clean up old embeddings daily at 2 AM
  await scheduleAITask(
    app,
    'cleanup-old-embeddings',
    '0 2 * * *',
    {
      operation: 'cleanup',
      target: 'embeddings',
      retentionDays: 30,
    }
  );

  // Generate daily analytics at 6 AM
  await scheduleAITask(
    app,
    'daily-analytics',
    '0 6 * * *',
    {
      operation: 'analytics',
      type: 'daily',
    }
  );

  // Health check every hour
  await scheduleAITask(
    app,
    'health-check',
    '0 * * * *',
    {
      operation: 'health-check',
      components: ['database', 'ai-models', 'storage'],
    }
  );
}

/**
 * Example: Queue high-priority real-time processing
 */
export async function queueRealTimeProcessing(
  app: Application,
  data: any,
  processingType: string
): Promise<string | null> {
  return await queueAIJob(app, 'processing', {
    data,
    processingType,
    realTime: true,
  }, {
    priority: 10, // Highest priority
    retryLimit: 5,
    retryDelay: 1000,
    expireIn: '5 minutes', // Expire quickly if not processed
  });
}

export default {
  queueEmbeddingGeneration,
  queueBatchEmbeddings,
  queueAIAnalysis,
  queueDataImport,
  scheduleMaintenanceTasks,
  queueRealTimeProcessing,
};
