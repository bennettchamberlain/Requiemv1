import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

export const CALIBRATION_BASIS = 'self-consistency-vs-qwen-labels';

export interface CalibrationScore {
  scoredAt: string;
  brier: number | null;
  l0Top1Acc: number | null;
  l1Top3Acc: number | null;
  ece: number | null;
  coverage: number | null;
  driftFlag: boolean;
  nBuckets: number | null;
}

export interface CalibrationReport {
  basis: string;
  latest: CalibrationScore | null;
  history: CalibrationScore[];
}

/**
 * Read path over hbpe.prediction_score. Missing table (fresh install, scoring
 * not yet ported) degrades to an empty report — Forecast hides the panel.
 */
@Injectable()
export class CalibrationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(CalibrationService.name);
  }

  async getReport(context: UserServiceContext, limit = 14): Promise<CalibrationReport> {
    const clamped = Math.min(90, Math.max(1, limit));

    try {
      const rows = (await this.dataSource.query(
        `
        SELECT scored_at, brier, l0_top1_acc, l1_top3_acc, ece, coverage, drift_flag, n_buckets
        FROM hbpe.prediction_score
        WHERE user_id = $1
        ORDER BY scored_at DESC
        LIMIT $2
        `,
        [context.userId, clamped],
      )) as Array<Record<string, unknown>>;

      const history = rows.map((row) => this.toScore(row));

      return { basis: CALIBRATION_BASIS, latest: history[0] ?? null, history };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '42P01' || code === '3F000') {
        return { basis: CALIBRATION_BASIS, latest: null, history: [] };
      }

      this.logger.warn('Calibration read failed', {
        userId: context.userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return { basis: CALIBRATION_BASIS, latest: null, history: [] };
    }
  }

  private toScore(row: Record<string, unknown>): CalibrationScore {
    const scoredAt = row.scored_at instanceof Date ? row.scored_at.toISOString() : String(row.scored_at);

    return {
      scoredAt,
      brier: numOrNull(row.brier),
      l0Top1Acc: numOrNull(row.l0_top1_acc),
      l1Top3Acc: numOrNull(row.l1_top3_acc),
      ece: numOrNull(row.ece),
      coverage: numOrNull(row.coverage),
      driftFlag: Boolean(row.drift_flag),
      nBuckets: numOrNull(row.n_buckets),
    };
  }
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const n = typeof value === 'number' ? value : Number(value);

  return Number.isFinite(n) ? n : null;
}
