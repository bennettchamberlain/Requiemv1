// Job Administration API Service
// RESTful endpoints for job management and monitoring

import { ServiceAddons } from '@feathersjs/feathers';
import { Application } from '../configuration/types';
import { JobAdminService } from './job-admin.service';

interface JobAdminData {
  action?: 'retry' | 'remove' | 'pause' | 'resume' | 'clean';
  jobId?: string;
  queueName?: string;
  olderThan?: number;
}

interface JobAdminParams {
  query?: {
    queue?: string;
    state?: string;
    limit?: string;
    offset?: string;
  };
}

export class JobAdminApiService {
  app: Application;
  adminService: JobAdminService;

  constructor(app: Application) {
    this.app = app;
    this.adminService = new JobAdminService(app);
  }

  /**
   * GET /admin/jobs - Get all jobs with filtering
   */
  async find(params: JobAdminParams) {
    const { query = {} } = params;

    const options = {
      queue: query.queue,
      state: query.state,
      limit: query.limit ? parseInt(query.limit) : 50,
      offset: query.offset ? parseInt(query.offset) : 0
    };

    return await this.adminService.getAllJobs(options);
  }

  /**
   * GET /admin/jobs/:id - Get specific job details
   */
  async get(id: string) {
    const { jobs } = await this.adminService.getAllJobs({ limit: 1000 });
    const job = jobs.find(j => j.id === id);

    if (!job) {
      throw new Error(`Job with id ${id} not found`);
    }

    return job;
  }

  /**
   * POST /admin/jobs - Perform job actions (retry, remove, etc.)
   */
  async create(data: JobAdminData) {
    const { action, jobId, queueName, olderThan } = data;

    switch (action) {
      case 'retry':
        if (!jobId) throw new Error('jobId is required for retry action');
        return { success: await this.adminService.retryJob(jobId), action: 'retry', jobId };

      case 'remove':
        if (!jobId) throw new Error('jobId is required for remove action');
        return { success: await this.adminService.removeJob(jobId), action: 'remove', jobId };

      case 'pause':
        if (!queueName) throw new Error('queueName is required for pause action');
        return { success: await this.adminService.pauseQueue(queueName), action: 'pause', queueName };

      case 'resume':
        if (!queueName) throw new Error('queueName is required for resume action');
        return { success: await this.adminService.resumeQueue(queueName), action: 'resume', queueName };

      case 'clean':
        if (!queueName) throw new Error('queueName is required for clean action');
        const cleanedCount = await this.adminService.cleanQueue(queueName, olderThan);
        return { success: true, action: 'clean', queueName, cleanedCount };

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
}

export class HealthCheckApiService {
  app: Application;
  adminService: JobAdminService;

  constructor(app: Application) {
    this.app = app;
    this.adminService = new JobAdminService(app);
  }

  /**
   * GET /health - Basic health check
   */
  async find() {
    const health = await this.adminService.getSystemHealth();
    return {
      status: health.status,
      timestamp: health.timestamp,
      uptime: health.uptime
    };
  }

  /**
   * GET /health/detailed - Detailed health check
   */
  async get(id: string) {
    if (id === 'detailed') {
      return await this.adminService.getSystemHealth();
    }
    throw new Error('Invalid health check endpoint');
  }
}

export class DashboardApiService {
  app: Application;
  adminService: JobAdminService;

  constructor(app: Application) {
    this.app = app;
    this.adminService = new JobAdminService(app);
  }

  /**
   * GET /dashboard/metrics - Get dashboard metrics
   */
  async find() {
    return await this.adminService.getDashboardMetrics();
  }

  /**
   * GET /dashboard/queues - Get queue statistics
   */
  async get(id: string) {
    if (id === 'queues') {
      return await this.adminService.getQueueStats();
    }
    throw new Error('Invalid dashboard endpoint');
  }
}

// Service setup functions
export function setupJobAdminService(app: Application) {
  (app as any).use('/admin/jobs', new JobAdminApiService(app));
}

export function setupHealthCheckService(app: Application) {
  (app as any).use('/health', new HealthCheckApiService(app));
}

export function setupDashboardService(app: Application) {
  (app as any).use('/dashboard', new DashboardApiService(app));
}

export type JobAdminApiServiceType = ServiceAddons<JobAdminApiService>;
export type HealthCheckApiServiceType = ServiceAddons<HealthCheckApiService>;
export type DashboardApiServiceType = ServiceAddons<DashboardApiService>;
