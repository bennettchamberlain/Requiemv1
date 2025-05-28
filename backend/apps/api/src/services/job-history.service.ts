// Job History Service: persists job events to the database
import type { Application } from '../configuration/types';
import type { Knex } from 'knex';

export interface JobHistoryRecord {
  id: string;
  queue: string;
  type: string;
  data: unknown;
  status: string;
  attempts: number;
  result?: unknown;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class JobHistoryService {
  private db: Knex;
  constructor(app: Application) {
    this.db = app.get('postgresqlClient');
  }

  async add(record: JobHistoryRecord) {
    return this.db('job_history').insert(record);
  }

  async findByJobId(id: string) {
    return this.db('job_history').where({ id }).first();
  }

  async findAll({
    queue,
    status,
    limit = 50,
    offset = 0,
  }: {
    queue?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    let q = this.db('job_history');
    if (queue) q = q.where({ queue });
    if (status) q = q.where({ status });
    return q.orderBy('createdAt', 'desc').limit(limit).offset(offset);
  }
}
