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
  type: 'embedding' | 'analysis' | 'processing',
  data: any,
  options?: any
): Promise<string | null> {
  const jobQueue = getJobQueue(app);
  return await jobQueue.sendJob('ai-processing', { type, ...data }, options);
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
