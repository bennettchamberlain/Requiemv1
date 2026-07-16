import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import type { PredictionScoreRow } from '../types';

export const DEFAULT_CALIBRATION_LIMIT = 14;
export const MAX_CALIBRATION_LIMIT = 90;
export const DEFAULT_CALIBRATION_WINDOW_DAYS = 30;
export const MAX_CALIBRATION_WINDOW_DAYS = 365;

/**
 * Reads the HBPE live-scoring results from hbpe.prediction_score (written
 * nightly by the sidecar's scoring step — backend/apps/hbpe/src/ci/pipeline/
 * scoring.py; canonical DDL in migration 20260707054821_hbpe_prediction_score.sql).
 *
 * HONESTY NOTE: these metrics measure forecast SELF-CONSISTENCY — how well the
 * issued forecasts anticipated the behavior labels the pipeline itself later
 * derived (Qwen-labeled events serialized into hbpe.token_stream and backfilled
 * as actuals). They are NOT ground-truth accuracy against independently
 * verified behavior and must not be presented as such; the GraphQL type's
 * `basis` field ('self-consistency-vs-qwen-labels') carries this caveat to
 * downstream UIs.
 */
@Injectable()
export class CalibrationService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(CalibrationService.name);
  }

  /**
   * Latest scoring runs for the user, newest first (row 0 = latest; the rest
   * form a short trend). Returns [] when the user has no scores yet or the
   * table/schema does not exist (new installs where neither the migration nor
   * the sidecar's self-bootstrap has run).
   */
  async getScores(
    context: UserServiceContext,
    limit = DEFAULT_CALIBRATION_LIMIT,
  ): Promise<PredictionScoreRow[]> {
    const capped = Math.min(
      Math.max(Math.trunc(limit) || DEFAULT_CALIBRATION_LIMIT, 1),
      MAX_CALIBRATION_LIMIT,
    );

    try {
      return (await this.dataSource.query(
        `SELECT scored_at, window_start, window_end, brier, l0_top1_acc, l1_top3_acc,
                ece, coverage, reliability_json, drift_flag, n_buckets
         FROM hbpe.prediction_score
         WHERE user_id = $1
         ORDER BY scored_at DESC
         LIMIT $2`,
        [context.userId, capped],
      )) as PredictionScoreRow[];
    } catch (err) {
      if (this.isMissingRelation(err)) {
        this.logger.debug('hbpe.prediction_score does not exist yet — returning no calibration scores');

        return [];
      }

      throw err;
    }
  }

  /**
   * Scoring runs whose scored_at falls within the trailing windowDays, newest
   * first (row 0 = latest; the rest form the trend). The same missing-table
   * tolerance as getScores applies; the row count is additionally capped at
   * MAX_CALIBRATION_LIMIT so a pathological window cannot balloon the payload.
   */
  async getScoresSince(
    context: UserServiceContext,
    windowDays = DEFAULT_CALIBRATION_WINDOW_DAYS,
  ): Promise<PredictionScoreRow[]> {
    const days = Math.min(
      Math.max(Math.trunc(windowDays) || DEFAULT_CALIBRATION_WINDOW_DAYS, 1),
      MAX_CALIBRATION_WINDOW_DAYS,
    );

    try {
      return (await this.dataSource.query(
        `SELECT scored_at, window_start, window_end, brier, l0_top1_acc, l1_top3_acc,
                ece, coverage, reliability_json, drift_flag, n_buckets
         FROM hbpe.prediction_score
         WHERE user_id = $1
           AND scored_at >= NOW() - make_interval(days => $2::int)
         ORDER BY scored_at DESC
         LIMIT $3`,
        [context.userId, days, MAX_CALIBRATION_LIMIT],
      )) as PredictionScoreRow[];
    } catch (err) {
      if (this.isMissingRelation(err)) {
        this.logger.debug('hbpe.prediction_score does not exist yet — returning no calibration scores');

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
