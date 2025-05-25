import type { Application } from '../configuration/types';
import type { JobQueueService } from '../services/job-queue-service';

/**
 * Get the job queue service instance from the application
 */
export function getJobQueue(app: Application): JobQueueService {
  const jobQueueService = app.get('jobQueueService' as any);
  if (!jobQueueService) {
    throw new Error('Job queue service is not configured');
  }
  return jobQueueService as JobQueueService;
}

/**
 * Queue an AI processing job
 */
export async function queueAIJob(
  app: Application,
  type: 'embedding' | 'analysis' | 'processing' | 'pipeline' | 'batch-processing' | 'multi-model' | 'priority-processing' | 'dependent-processing' | 'streaming' | 'circuit-breaker',
  data: any,
  options?: any
): Promise<string | null> {
  const jobQueue = getJobQueue(app);

  // Route to appropriate queue based on type
  const queueMap: Record<string, string> = {
    'embedding': 'ai-processing',
    'analysis': 'ai-processing',
    'processing': 'ai-processing',
    'pipeline': 'pipeline',
    'batch-processing': 'batch-processing',
    'multi-model': 'multi-model',
    'priority-processing': 'ai-processing',
    'dependent-processing': 'ai-processing',
    'streaming': 'ai-processing',
    'circuit-breaker': 'ai-processing'
  };

  const queue = queueMap[type] || 'ai-processing';
  return await jobQueue.sendJob(queue, { type, ...data }, options);
}

/**
 * Queue a notification job
 */
export async function queueNotification(
  app: Application,
  type: 'email' | 'push' | 'sms',
  data: any,
  options?: any
): Promise<string | null> {
  const jobQueue = getJobQueue(app);
  return await jobQueue.sendJob('notifications', { type, ...data }, options);
}

/**
 * Queue a data processing job
 */
export async function queueDataProcessing(
  app: Application,
  operation: string,
  data: any,
  options?: any
): Promise<string | null> {
  const jobQueue = getJobQueue(app);
  return await jobQueue.sendJob('data-processing', { operation, ...data }, options);
}

/**
 * Schedule a recurring AI task
 */
export async function scheduleAITask(
  app: Application,
  name: string,
  cronExpression: string,
  taskData: any,
  options?: any
): Promise<void> {
  const jobQueue = getJobQueue(app);
  await jobQueue.scheduleJob(name, cronExpression, taskData, options);
}

export default {
  getJobQueue,
  queueAIJob,
  queueNotification,
  queueDataProcessing,
  scheduleAITask,
};
