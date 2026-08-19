import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

/**
 * Process-wide hook the `@Cron` decorator uses to persist last-fire times
 * without Nest DI in the decorator itself.
 *
 * {@link configure} is called once from EventsModule when the app DataSource is
 * ready. Until then `record` is a no-op so unit tests stay quiet.
 */
class CronRunStoreImpl {
  private dataSource: DataSource | null = null;

  private readonly logger = new Logger('CronRunStore');

  configure(dataSource: DataSource): void {
    this.dataSource = dataSource;
  }

  /**
   * Fire-and-forget upsert. A persist failure must not take down the tick —
   * the schedule is more important than the dashboard cell.
   */
  record(name: string, at: Date = new Date()): void {
    const dataSource = this.dataSource;
    if (!dataSource || !name) {
      return;
    }

    void dataSource
      .query(
        `
          INSERT INTO ci.cron_runs (name, last_run_at)
          VALUES ($1, $2)
          ON CONFLICT (name) DO UPDATE
            SET last_run_at = EXCLUDED.last_run_at
        `,
        [name, at],
      )
      .catch((err: unknown) => {
        this.logger.warn(
          `Failed to persist last_run_at for ${name}`,
          err instanceof Error ? err.stack : String(err),
        );
      });
  }

  async lastRunByName(): Promise<Map<string, Date>> {
    const dataSource = this.dataSource;
    if (!dataSource) {
      return new Map();
    }

    const rows = await dataSource.query<{ name: string; last_run_at: Date | string }[]>(
      `SELECT name, last_run_at FROM ci.cron_runs`,
    );

    const map = new Map<string, Date>();
    for (const row of rows) {
      map.set(row.name, row.last_run_at instanceof Date ? row.last_run_at : new Date(row.last_run_at));
    }

    return map;
  }
}

export const CronRunStore = new CronRunStoreImpl();
