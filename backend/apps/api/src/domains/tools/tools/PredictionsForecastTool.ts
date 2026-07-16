import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { toServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { HbpeService, type ForecastResponse } from '@ci/domains/predictions';

import { BaseTool } from '../core/BaseTool';
import type { IntentDefinition, ToolExecutionContext } from '../core/types';

const PredictionsForecastInputSchema = z.object({
  horizon: z.enum(['24h']).optional().default('24h'),
});

export type PredictionsForecastInput = z.infer<typeof PredictionsForecastInputSchema>;

export interface ForecastLabelProbability {
  label: string;
  probability: number;
}

export interface ForecastSummaryBucket {
  bucketIndex: number;
  /** ISO-8601 start time of the 30-minute bucket. */
  startTime: string;
  /** Dominant predicted L0 activity class, null when the histogram bucket is empty. */
  dominantL0: ForecastLabelProbability | null;
  /** Highest-probability fine-grained L1 activity, null when no L1 distribution exists. */
  topL1: ForecastLabelProbability | null;
}

export interface PredictionsForecastOutput {
  horizon: string;
  generatedAt: string;
  /** HBPE engine status: COLD_START, TRAINING, or READY. */
  systemStatus: string;
  bucketCount: number;
  buckets: ForecastSummaryBucket[];
}

/**
 * Reduce the raw 48-bucket HBPE histogram to the agent-consumable summary:
 * per bucket, the dominant L0 class + probability and the top L1 activity.
 * Pure and deterministic — exported for direct unit testing.
 */
export function summarizeForecast(response: ForecastResponse): PredictionsForecastOutput {
  const buckets = (response.buckets ?? []).map((bucket) => ({
    bucketIndex: bucket.bucket_index,
    startTime: bucket.start_time,
    dominantL0: dominantEntry(bucket.l0_probs),
    topL1: dominantEntry(bucket.l1_probs),
  }));

  return {
    horizon: response.horizon,
    generatedAt: response.generated_at,
    systemStatus: response.system_status,
    bucketCount: buckets.length,
    buckets,
  };
}

function dominantEntry(probs: Record<string, number> | null | undefined): ForecastLabelProbability | null {
  if (!probs) {
    return null;
  }

  let best: ForecastLabelProbability | null = null;

  for (const [label, value] of Object.entries(probs)) {
    const probability = Number(value);

    if (Number.isNaN(probability)) {
      continue;
    }

    // Deterministic tie-break: keep the alphabetically-first label on equal probability.
    if (
      best === null ||
      probability > best.probability ||
      (probability === best.probability && label.localeCompare(best.label) < 0)
    ) {
      best = { label, probability: round4(probability) };
    }
  }

  return best;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Curated intent over the HBPE day-ahead forecast: what the user will likely
 * be doing, per 30-minute bucket, summarized for agent consumption (dominant
 * L0 class + probability + top L1) instead of the raw histogram.
 */
@Injectable()
export class PredictionsForecastTool extends BaseTool<PredictionsForecastInput, PredictionsForecastOutput> {
  readonly schema: IntentDefinition = {
    name: 'predictions.forecast',
    domain: 'predictions',
    title: 'Forecast behavior',
    description:
      'Predict what the user will likely be doing over the next day. Returns 48 half-hour buckets, ' +
      'each with the dominant predicted activity class (L0) and its probability plus the most likely ' +
      'fine-grained activity (L1), and the engine status (COLD_START/TRAINING/READY).',
    privacy: { access: 'read', sensitivity: 'personal', destructive: false, external: false },
    phrases: [
      'What will I be doing at $time',
      'When am I free $day',
      'Predict my day tomorrow',
      'What does tomorrow look like for me',
    ],
    parameters: {
      type: 'object',
      properties: {
        horizon: {
          type: 'string',
          enum: ['24h'],
          default: '24h',
          description: "Forecast horizon; only '24h' (48 × 30-minute buckets) is supported.",
        },
      },
    },
    examples: [
      {
        input: { horizon: '24h' },
        output: {
          horizon: '24h',
          systemStatus: 'READY',
          bucketCount: 48,
          buckets: [
            {
              bucketIndex: 30,
              startTime: '2026-07-16T15:00:00Z',
              dominantL0: { label: 'WORK', probability: 0.72 },
              topL1: { label: 'Deep Focus', probability: 0.65 },
            },
          ],
        },
        description: 'Day-ahead forecast: at 3pm the user is most likely working (deep focus).',
      },
    ],
  };

  constructor(
    private readonly hbpeService: HbpeService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(PredictionsForecastTool.name);
  }

  protected validateInput(input: unknown): PredictionsForecastInput {
    return PredictionsForecastInputSchema.parse(input ?? {});
  }

  protected async executeInternal(
    context: ToolExecutionContext,
    input: PredictionsForecastInput,
  ): Promise<PredictionsForecastOutput> {
    const response = await this.hbpeService.getForecast(toServiceContext(context), input.horizon);

    return summarizeForecast(response);
  }
}
