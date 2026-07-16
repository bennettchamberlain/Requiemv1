import { Module } from '@nestjs/common';

import { LoggingModule } from '@ci/common/logging';

import {
  CalibrationService,
  DEFAULT_CALIBRATION_LIMIT,
  MAX_CALIBRATION_LIMIT,
} from './services/CalibrationService';
import { HbpeService } from './services/HbpeService';

@Module({
  imports: [LoggingModule],
  providers: [HbpeService, CalibrationService],
  exports: [HbpeService, CalibrationService],
})
export class PredictionsModule {}

export { CalibrationService, DEFAULT_CALIBRATION_LIMIT, HbpeService, MAX_CALIBRATION_LIMIT };
export type { ForecastBucket, ForecastResponse, PredictionScoreRow, ReliabilityBinRow } from './types';
