import { Module } from '@nestjs/common';

import { LoggingModule } from '@ci/common/logging';

import {
  CalibrationService,
  DEFAULT_CALIBRATION_LIMIT,
  DEFAULT_CALIBRATION_WINDOW_DAYS,
  MAX_CALIBRATION_LIMIT,
  MAX_CALIBRATION_WINDOW_DAYS,
} from './services/CalibrationService';
import { FORECAST_HISTORY_DATE_PATTERN, ForecastHistoryService } from './services/ForecastHistoryService';
import { HbpeService } from './services/HbpeService';

@Module({
  imports: [LoggingModule],
  providers: [HbpeService, CalibrationService, ForecastHistoryService],
  exports: [HbpeService, CalibrationService, ForecastHistoryService],
})
export class PredictionsModule {}

export {
  CalibrationService,
  DEFAULT_CALIBRATION_LIMIT,
  DEFAULT_CALIBRATION_WINDOW_DAYS,
  FORECAST_HISTORY_DATE_PATTERN,
  ForecastHistoryService,
  HbpeService,
  MAX_CALIBRATION_LIMIT,
  MAX_CALIBRATION_WINDOW_DAYS,
};
export type {
  ForecastBucket,
  ForecastHistoryBucketRow,
  ForecastResponse,
  PredictionScoreRow,
  ReliabilityBinRow,
} from './types';
