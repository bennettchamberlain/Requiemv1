import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import type { ForecastHistoryBucketRow } from '../types';

/** Calendar-date argument shape accepted by {@link ForecastHistoryService.getHistory}. */
export const FORECAST_HISTORY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads the per-bucket forecast history for a past local date from
 * hbpe.prediction_log (DDL in migration 20260227000001_hbpe_all_tables.sql).
 *
 * Every /histogram call logs 48 buckets sharing one horizon_start (midnight
 * UTC of the forecast day — see backend/apps/hbpe/src/ci/pipeline/
 * histogram_api.py), and the nightly actuals backfill later fills actual_l0
 * once the day has elapsed. For a given date this service returns the LATEST
 * logged prediction per bucket_index together with its backfilled actual,
 * powering the dashboard's past-day heatmap rows and the predicted-vs-actual
 * timeline overlay.
 */
@Injectable()
export class ForecastHistoryService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ForecastHistoryService.name);
  }

  /**
   * Latest logged forecast per 30-minute bucket for the given date
   * (YYYY-MM-DD, matched against the forecast day's UTC calendar date — the
   * same convention the actuals backfill uses), each joined with its
   * backfilled actual_l0. Returns [] when no forecast was issued for that
   * date or the hbpe schema/table does not exist yet (fresh installs).
   */
  async getHistory(context: UserServiceContext, date: string): Promise<ForecastHistoryBucketRow[]> {
    if (!FORECAST_HISTORY_DATE_PATTERN.test(date)) {
      throw new BadRequestException('date must be a calendar date formatted YYYY-MM-DD');
    }

    try {
      return (await this.dataSource.query(
        `SELECT DISTINCT ON (bucket_index)
                bucket_index, horizon_start, predicted_at, l0_probs, actual_l0
         FROM hbpe.prediction_log
         WHERE user_id = $1
           AND (horizon_start AT TIME ZONE 'UTC')::date = $2::date
         ORDER BY bucket_index ASC, predicted_at DESC`,
        [context.userId, date],
      )) as ForecastHistoryBucketRow[];
    } catch (err) {
      if (this.isMissingRelation(err)) {
        this.logger.debug('hbpe.prediction_log does not exist yet — returning no forecast history');

        return [];
      }

      throw err;
    }
  }

  /**
   * Postgres 42P01 (undefined_table) / 3F000 (invalid_schema_name) — the table
   * or the hbpe schema is absent on fresh installs. TypeORM wraps the driver
   * error, so check both the error itself and driverError.
   */
  private isMissingRelation(err: unknown): boolean {
    const wrapped = err as { code?: string; driverError?: { code?: string } };
    const code = wrapped?.code ?? wrapped?.driverError?.code;

    return code === '42P01' || code === '3F000';
  }
}
