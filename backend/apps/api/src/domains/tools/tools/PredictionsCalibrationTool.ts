import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { toServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { CalibrationService, type PredictionScoreRow } from '@ci/domains/predictions';

import { BaseTool } from '../core/BaseTool';
import type { IntentDefinition, ToolExecutionContext } from '../core/types';

// No parameters — unknown keys are stripped (zod default) rather than rejected.
const PredictionsCalibrationInputSchema = z.object({});

export type PredictionsCalibrationInput = z.infer<typeof PredictionsCalibrationInputSchema>;

/**
 * What the calibration numbers actually measure: forecasts scored against
 * behavior labels the pipeline itself derived from Qwen-labeled events —
 * forecast self-consistency, NOT ground-truth accuracy. Mirrors the GraphQL
 * egress's basis field so agents carry the same caveat.
 */
export const CALIBRATION_TOOL_BASIS = 'self-consistency-vs-qwen-labels';

export interface PredictionsCalibrationOutput {
  /** False when the nightly scoring loop has not produced any run yet. */
  scored: boolean;
  scoredAt: string | null;
  brier: number | null;
  l0Top1Accuracy: number | null;
  l1Top3Accuracy: number | null;
  ece: number | null;
  coverage: number | null;
  driftFlag: boolean;
  basis: string;
  /** One-line plain-language quality statement, derived deterministically from thresholds. */
  quality: string;
}

const ACC_STRONG = 0.7;
const ACC_FAIR = 0.5;
const ECE_WELL_CALIBRATED = 0.05;
const ECE_ROUGHLY_CALIBRATED = 0.15;

/**
 * Deterministic plain-language quality statement from fixed thresholds — no
 * LLM involved. Exported for direct unit testing.
 */
export function calibrationQualityStatement(row: PredictionScoreRow | null): string {
  if (row === null || row.l0_top1_acc === null) {
    return 'No scored forecasts yet — quality cannot be judged until the nightly scoring loop has run.';
  }

  const pct = Math.round(row.l0_top1_acc * 100);
  let statement: string;

  if (row.l0_top1_acc >= ACC_STRONG) {
    statement = `Forecast quality is strong: the top prediction matched observed behavior ${pct}% of the time`;
  } else if (row.l0_top1_acc >= ACC_FAIR) {
    statement = `Forecast quality is fair: the top prediction matched observed behavior ${pct}% of the time`;
  } else {
    statement = `Forecast quality is weak: the top prediction matched observed behavior only ${pct}% of the time`;
  }

  if (row.ece !== null && row.ece !== undefined) {
    if (row.ece <= ECE_WELL_CALIBRATED) {
      statement += ' and its confidence is well calibrated.';
    } else if (row.ece <= ECE_ROUGHLY_CALIBRATED) {
      statement += ' and its confidence is roughly calibrated.';
    } else {
      statement += ' but its stated confidence is poorly calibrated (probabilities overstate accuracy).';
    }
  } else {
    statement += '.';
  }

  if (row.drift_flag) {
    statement += ' Accuracy has recently drifted below its trailing baseline.';
  }

  return statement;
}

/**
 * Curated intent over the HBPE live scoring loop (hbpe.prediction_score):
 * how good the behavior forecasts have actually been, with a deterministic
 * plain-language quality statement an agent can relay verbatim.
 */
@Injectable()
export class PredictionsCalibrationTool extends BaseTool<
  PredictionsCalibrationInput,
  PredictionsCalibrationOutput
> {
  readonly schema: IntentDefinition = {
    name: 'predictions.calibration',
    domain: 'predictions',
    title: 'Forecast quality',
    description:
      'Report how accurate the behavior forecasts have been: Brier score, top-1/top-3 accuracy, expected ' +
      'calibration error, drift flag, and a one-line plain-language quality statement. Metrics measure ' +
      'forecast self-consistency against pipeline-derived behavior labels, not ground-truth accuracy.',
    privacy: { access: 'read', sensitivity: 'personal', destructive: false, external: false },
    phrases: [
      'How accurate are my predictions',
      'How good is the forecast',
      'Is the behavior model drifting',
    ],
    parameters: {
      type: 'object',
      properties: {},
    },
    examples: [
      {
        input: {},
        output: {
          scored: true,
          l0Top1Accuracy: 0.75,
          ece: 0.08,
          driftFlag: false,
          quality:
            'Forecast quality is strong: the top prediction matched observed behavior 75% of the time ' +
            'and its confidence is roughly calibrated.',
        },
        description: 'Latest scoring run summarized with a plain-language quality statement.',
      },
    ],
  };

  constructor(
    private readonly calibrationService: CalibrationService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(PredictionsCalibrationTool.name);
  }

  protected validateInput(input: unknown): PredictionsCalibrationInput {
    return PredictionsCalibrationInputSchema.parse(input ?? {});
  }

  protected async executeInternal(context: ToolExecutionContext): Promise<PredictionsCalibrationOutput> {
    const rows = await this.calibrationService.getScores(toServiceContext(context), 1);
    const latest = rows[0] ?? null;

    return {
      scored: latest !== null,
      scoredAt: latest ? toIsoString(latest.scored_at) : null,
      brier: latest?.brier ?? null,
      l0Top1Accuracy: latest?.l0_top1_acc ?? null,
      l1Top3Accuracy: latest?.l1_top3_acc ?? null,
      ece: latest?.ece ?? null,
      coverage: latest?.coverage ?? null,
      driftFlag: latest?.drift_flag ?? false,
      basis: CALIBRATION_TOOL_BASIS,
      quality: calibrationQualityStatement(latest),
    };
  }
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
