import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * One sample of one queue's behaviour. See the migration
 * `20260817030000_add_job_metrics.sql` for why this table exists at all —
 * pg-boss keeps roughly 36 hours of working set and no history.
 */
@Entity({ schema: 'ci', name: 'job_metrics' })
export class JobMetricEntity {
  @PrimaryColumn({ name: 'sampled_at', type: 'timestamptz' })
  sampledAt!: Date;

  @PrimaryColumn({ name: 'queue', type: 'text' })
  queue!: string;

  @Column({ name: 'pending', type: 'integer', default: 0 })
  pending!: number;

  @Column({ name: 'active', type: 'integer', default: 0 })
  active!: number;

  @Column({ name: 'retry', type: 'integer', default: 0 })
  retry!: number;

  @Column({ name: 'dead_lettered', type: 'integer', default: 0 })
  deadLettered!: number;

  /** Jobs that completed during the interval ending at `sampledAt` — a delta, not a total. */
  @Column({ name: 'completed', type: 'integer', default: 0 })
  completed!: number;

  /** Jobs that failed during the interval ending at `sampledAt` — a delta, not a total. */
  @Column({ name: 'failed', type: 'integer', default: 0 })
  failed!: number;

  @Column({ name: 'avg_duration_ms', type: 'integer', nullable: true })
  avgDurationMs!: number | null;

  @Column({ name: 'p95_duration_ms', type: 'integer', nullable: true })
  p95DurationMs!: number | null;
}
