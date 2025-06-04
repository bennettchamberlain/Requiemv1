// Advanced Retry Logic: Exponential backoff and dead letter queue for BullMQ
import { Job, Queue } from 'bullmq';

export function getExponentialBackoff(attempts: number, base = 1000, factor = 2, max = 60000) {
  return Math.min(base * Math.pow(factor, attempts - 1), max);
}

export async function handleJobFailure(job: Job, queue: Queue, deadLetterQueue: Queue) {
  if (job.attemptsMade >= (job.opts.attempts || 3)) {
    // Move to dead letter queue
    await deadLetterQueue.add('dead-letter', job.data, { jobId: job.id });
  }
}
