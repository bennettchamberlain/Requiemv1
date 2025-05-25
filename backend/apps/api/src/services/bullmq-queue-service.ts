// BullMQ-based Job Queue Service for integration testing and advanced features
import { Queue, Worker, QueueScheduler, Job, QueueEvents } from 'bullmq';
import { Logger } from '../utils';
import type { Application } from '../configuration/types';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export class BullMQQueueService {
  private queue: Queue;
  private scheduler: QueueScheduler;
  private worker: Worker | null = null;
  private events: QueueEvents;
  private logger = Logger.create('BullMQQueueService');

  constructor(private app: Application, queueName = 'ai-processing') {
    this.queue = new Queue(queueName, { connection: { url: REDIS_URL } });
    this.scheduler = new QueueScheduler(queueName, { connection: { url: REDIS_URL } });
    this.events = new QueueEvents(queueName, { connection: { url: REDIS_URL } });
  }

  async addJob(data: any, opts: any = {}) {
    return this.queue.add('job', data, opts);
  }

  async getJob(id: string) {
    return this.queue.getJob(id);
  }

  async getJobs(types: ('completed'|'failed'|'waiting'|'active'|'delayed')[] = ['waiting','active','completed','failed']) {
    return this.queue.getJobs(types);
  }

  async getJobCounts() {
    return this.queue.getJobCounts();
  }

  async process(handler: (job: Job) => Promise<any>) {
    if (this.worker) return;
    this.worker = new Worker(this.queue.name, handler, { connection: { url: REDIS_URL } });
    this.worker.on('completed', (job) => this.logger.info(`Job ${job.id} completed`));
    this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.id} failed:`, err));
  }

  async close() {
    await this.worker?.close();
    await this.queue.close();
    await this.scheduler.close();
    await this.events.close();
  }
}
