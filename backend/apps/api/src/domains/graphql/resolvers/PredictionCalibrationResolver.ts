import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import {
  CalibrationService,
  DEFAULT_CALIBRATION_LIMIT,
  DEFAULT_CALIBRATION_WINDOW_DAYS,
} from '@ci/domains/predictions';

import { PredictionCalibrationType } from '../types/PredictionCalibrationType';

/**
 * Egress for the HBPE live scoring loop (hbpe.prediction_score).
 *
 * HONESTY NOTE: the exposed metrics measure forecast SELF-CONSISTENCY — issued
 * forecasts scored against behavior labels the pipeline itself derived from
 * Qwen-labeled events — not ground-truth accuracy. The type's `basis` field
 * ('self-consistency-vs-qwen-labels') carries this framing downstream.
 */
@UseGuards(JwtOrApiKeyAuthGuard)
@Resolver(() => PredictionCalibrationType)
export class PredictionCalibrationResolver {
  constructor(
    private readonly calibrationService: CalibrationService,
    private readonly featureService: FeatureService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PredictionCalibrationResolver.name);
  }

  @Query(() => PredictionCalibrationType, {
    nullable: true,
    description:
      'HBPE forecast calibration: latest live-scoring run plus a short trend (newest first). Measures ' +
      'forecast self-consistency against Qwen-derived behavior labels — not ground-truth accuracy.',
  })
  async predictionCalibration(
    @Context() context: RequestContext,
    @Args('limit', { type: () => Int, nullable: true, defaultValue: DEFAULT_CALIBRATION_LIMIT })
    limit: number,
  ): Promise<PredictionCalibrationType | null> {
    if (!(await this.featureService.isFeatureEnabled('hbpe'))) {
      return null;
    }

    try {
      const rows = await this.calibrationService.getScores(toServiceContext(context), limit);

      return PredictionCalibrationType.toType(rows);
    } catch (err) {
      this.logger.error(
        'Prediction calibration query failed',
        err instanceof Error ? err : new Error(String(err)),
      );

      return null;
    }
  }

  @Query(() => PredictionCalibrationType, {
    nullable: true,
    description:
      'HBPE forecast calibration over a trailing window of days: latest live-scoring run plus the trend ' +
      '(newest first). Measures forecast self-consistency against Qwen-derived behavior labels — not ' +
      'ground-truth accuracy.',
  })
  async calibration(
    @Context() context: RequestContext,
    @Args('windowDays', { type: () => Int, nullable: true, defaultValue: DEFAULT_CALIBRATION_WINDOW_DAYS })
    windowDays: number,
  ): Promise<PredictionCalibrationType | null> {
    if (!(await this.featureService.isFeatureEnabled('hbpe'))) {
      return null;
    }

    try {
      const rows = await this.calibrationService.getScoresSince(toServiceContext(context), windowDays);

      return PredictionCalibrationType.toType(rows);
    } catch (err) {
      this.logger.error('Calibration query failed', err instanceof Error ? err : new Error(String(err)));

      return null;
    }
  }
}
