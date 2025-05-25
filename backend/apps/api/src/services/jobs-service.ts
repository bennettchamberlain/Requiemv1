import type { Params } from '@feathersjs/feathers';
import { validateData } from '@feathersjs/schema';
import { Type, Static, getValidator } from '@feathersjs/typebox';

import { Application } from '../configuration/types';
import { queryValidator } from '../configuration/validators';
import { getJobQueue } from '../utils/job-queue-utils';

// Job interface for PgBoss job structure
interface PgBossJobDetails {
  id: string;
  name: string;
  data: unknown;
  state?: string;
  priority?: number;
  retryCount?: number;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  startAfter?: Date | string;
  startedOn?: Date | string;
  singletonKey?: string;
  singletonOn?: Date | string;
  expireIn?: string;
  createdOn?: Date | string;
  completedOn?: Date | string;
  keepUntil?: Date | string;
  output?: unknown;
}

// Input validation schemas
export const JobInput = Type.Object(
  {
    queue: Type.String(),
    data: Type.Any(),
    options: Type.Optional(
      Type.Object({
        priority: Type.Optional(Type.Number()),
        delay: Type.Optional(Type.Number()),
        retryLimit: Type.Optional(Type.Number()),
        retryDelay: Type.Optional(Type.Number()),
        expireIn: Type.Optional(Type.String()),
      }),
    ),
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
    options: Type.Optional(
      Type.Object({
        priority: Type.Optional(Type.Number()),
        retryLimit: Type.Optional(Type.Number()),
      }),
    ),
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async create(input: JobInputType, _params?: Params) {
    const jobQueue = getJobQueue(this.app);

    const jobId = await jobQueue.sendJob(input.queue, input.data, input.options);

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async get(id: string, _params?: Params) {
    const jobQueue = getJobQueue(this.app);

    const jobResult = await jobQueue.getJob(id);

    if (!jobResult) {
      throw new Error(`Job ${id} not found`);
    }

    // Type cast the unknown result to our job interface
    const job = jobResult as PgBossJobDetails;

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async remove(_id: string, _params?: Params) {
    // Note: PgBoss v10+ requires queue name for cancel
    // For now, we'll return an error message
    throw new Error(
      'Cancel job requires queue name. Use PATCH /jobs/:id with action: "cancel" and queueName',
    );
  }

  /**
   * Update/Patch a job (for cancel, resume operations)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async patch(id: string, data: { action: 'cancel' | 'resume'; queueName: string }, _params?: Params) {
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async find(_params?: Params) {
    const jobQueue = getJobQueue(this.app);

    // Get queue sizes for common queues
    const queues = ['ai-processing', 'notifications', 'data-processing'];
    const queueInfo = await Promise.all(
      queues.map(async (queue) => ({
        name: queue,
        size: await jobQueue.getQueueSize(queue),
      })),
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async create(input: ScheduleJobInputType, _params?: Params) {
    const jobQueue = getJobQueue(this.app);

    await jobQueue.scheduleJob(input.name, input.cronExpression, input.data, input.options);

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
