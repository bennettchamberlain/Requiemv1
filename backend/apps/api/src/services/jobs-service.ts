import type { Params } from '@feathersjs/feathers';
import { validateData } from '@feathersjs/schema';
import { Type, Static, getValidator } from '@feathersjs/typebox';

import { Application } from '../configuration/types';
import { queryValidator } from '../configuration/validators';
import { getJobQueue } from '../utils/job-queue-utils';

// Input validation schemas
export const JobInput = Type.Object(
  {
    queue: Type.String(),
    data: Type.Any(),
    options: Type.Optional(Type.Object({
      priority: Type.Optional(Type.Number()),
      delay: Type.Optional(Type.Number()),
      retryLimit: Type.Optional(Type.Number()),
      retryDelay: Type.Optional(Type.Number()),
      expireIn: Type.Optional(Type.String()),
    })),
  },
  {
    additionalProperties: false,
  },
);

export const ScheduleJobInput = Type.Object(
  {
    name: Type.String(),
    cronExpression: Type.String(),
    data: Type.Optional(Type.Any()),
    options: Type.Optional(Type.Object({
      priority: Type.Optional(Type.Number()),
      retryLimit: Type.Optional(Type.Number()),
    })),
  },
  {
    additionalProperties: false,
  },
);

export type JobInputType = Static<typeof JobInput>;
export type ScheduleJobInputType = Static<typeof ScheduleJobInput>;

const jobValidator = getValidator(JobInput, queryValidator);
const scheduleJobValidator = getValidator(ScheduleJobInput, queryValidator);

export class JobsService {
  app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Create (send) a new job
   */
  async create(input: JobInputType, params?: Params) {
    const jobQueue = getJobQueue(this.app);

    const jobId = await jobQueue.sendJob(
      input.queue,
      input.data,
      input.options
    );

    return {
      success: true,
      jobId,
      queue: input.queue,
      message: `Job ${jobId} sent to queue ${input.queue}`,
    };
  }

  /**
   * Get job by ID
   */
  async get(id: string, params?: Params) {
    const jobQueue = getJobQueue(this.app);

    const job = await jobQueue.getJob(id);

    if (!job) {
      throw new Error(`Job ${id} not found`);
    }

    return {
      id: job.id,
      name: job.name,
      data: job.data,
      state: job.state,
      priority: job.priority,
      retryCount: job.retryCount,
      retryLimit: job.retryLimit,
      retryDelay: job.retryDelay,
      retryBackoff: job.retryBackoff,
      startAfter: job.startAfter,
      startedOn: job.startedOn,
      singletonKey: job.singletonKey,
      singletonOn: job.singletonOn,
      expireIn: job.expireIn,
      createdOn: job.createdOn,
      completedOn: job.completedOn,
      keepUntil: job.keepUntil,
      output: job.output,
    };
  }

  /**
   * Cancel a job
   */
  async remove(id: string, params?: Params) {
    const jobQueue = getJobQueue(this.app);

    // Note: PgBoss v10+ requires queue name for cancel
    // For now, we'll return an error message
    throw new Error('Cancel job requires queue name. Use PATCH /jobs/:id with action: "cancel" and queueName');
  }

  /**
   * Update/Patch a job (for cancel, resume operations)
   */
  async patch(id: string, data: { action: 'cancel' | 'resume'; queueName: string }, params?: Params) {
    const jobQueue = getJobQueue(this.app);

    if (data.action === 'cancel') {
      await jobQueue.cancelJob(data.queueName, id);
      return {
        success: true,
        jobId: id,
        message: `Job ${id} cancelled`,
      };
    } else if (data.action === 'resume') {
      await jobQueue.resumeJob(data.queueName, id);
      return {
        success: true,
        jobId: id,
        message: `Job ${id} resumed`,
      };
    }

    throw new Error('Invalid action. Use "cancel" or "resume"');
  }

  /**
   * Get queue information
   */
  async find(params?: Params) {
    const jobQueue = getJobQueue(this.app);

    // Get queue sizes for common queues
    const queues = ['ai-processing', 'notifications', 'data-processing'];
    const queueInfo = await Promise.all(
      queues.map(async (queue) => ({
        name: queue,
        size: await jobQueue.getQueueSize(queue),
      }))
    );

    return {
      success: true,
      queues: queueInfo,
      isReady: jobQueue.isReady(),
    };
  }

  static hooks = {
    before: {
      create: [validateData(jobValidator)],
    },
  };
}

export class ScheduledJobsService {
  app: Application;

  constructor(app: Application) {
    this.app = app;
  }

  /**
   * Schedule a new job
   */
  async create(input: ScheduleJobInputType, params?: Params) {
    const jobQueue = getJobQueue(this.app);

    await jobQueue.scheduleJob(
      input.name,
      input.cronExpression,
      input.data,
      input.options
    );

    return {
      success: true,
      name: input.name,
      cronExpression: input.cronExpression,
      message: `Job ${input.name} scheduled with cron: ${input.cronExpression}`,
    };
  }

  static hooks = {
    before: {
      create: [validateData(scheduleJobValidator)],
    },
  };
}
