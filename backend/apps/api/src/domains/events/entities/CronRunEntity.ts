import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Durable last-fire time for a Nest `@Cron` registration key.
 *
 * SchedulerRegistry only keeps `lastDate()` for the current process — after a
 * restart the Jobs page would show "—" for every schedule. This row is what
 * survives the API going away for two weeks.
 */
@Entity({ schema: 'ci', name: 'cron_runs' })
export class CronRunEntity {
  @PrimaryColumn({ name: 'name', type: 'text' })
  name!: string;

  @Column({ name: 'last_run_at', type: 'timestamptz' })
  lastRunAt!: Date;
}
