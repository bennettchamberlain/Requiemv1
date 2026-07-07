import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import type { PredictionScoreRow, ReliabilityBinRow } from '@ci/domains/predictions';

/**
 * What the calibration numbers actually measure. The HBPE scoring loop compares
 * issued forecasts against actuals that the pipeline itself derived from
 * Qwen-labeled events — i.e. forecast self-consistency, NOT ground-truth
 * accuracy. Exposed as a field so downstream UIs cannot mislabel the metric.
 */
export const CALIBRATION_BASIS = 'self-consistency-vs-qwen-labels';

@ObjectType({ description: 'One reliability-diagram confidence bin (empty bins have null stats)' })
export class ReliabilityBinType {
  @Field(() => Int)
  bin!: number;

  @Field(() => Float, { description: 'Lower edge of the confidence bin (inclusive)' })
  lower!: number;

  @Field(() => Float, { description: 'Upper edge of the confidence bin' })
  upper!: number;

  @Field(() => Int, { description: 'Scored buckets that fell in this bin' })
  count!: number;

  @Field(() => Float, { nullable: true })
  avgConfidence!: number | null;

  @Field(() => Float, { nullable: true })
  accuracy!: number | null;

  static toType(source: ReliabilityBinRow): ReliabilityBinType {
    return {
      bin: source.bin,
      lower: source.lower,
      upper: source.upper,
      count: source.count,
      avgConfidence: source.avg_confidence ?? null,
      accuracy: source.accuracy ?? null,
    };
  }
}

@ObjectType({
  description:
    'One HBPE scoring run over a window of elapsed forecasts. Measures forecast self-consistency ' +
    'against pipeline-derived (Qwen-labeled) actuals — not ground-truth accuracy.',
})
export class CalibrationScoreType {
  @Field(() => String, { description: 'ISO-8601 timestamp of the scoring run' })
  scoredAt!: string;

  @Field(() => String, { description: 'ISO-8601 start of the scored forecast window (inclusive)' })
  windowStart!: string;

  @Field(() => String, { description: 'ISO-8601 end of the scored forecast window (exclusive)' })
  windowEnd!: string;

  @Field(() => Float, {
    nullable: true,
    description: 'Multiclass Brier over the 8 L0 classes: 0 perfect, 0.875 uniform, 2 confidently wrong',
  })
  brier!: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Fraction of buckets whose argmax L0 class matched the actual',
  })
  l0Top1Acc!: number | null;

  @Field(() => Float, {
    nullable: true,
    description:
      'Fraction of buckets whose actual L1 cluster was among the 3 highest-probability L1 predictions',
  })
  l1Top3Acc!: number | null;

  @Field(() => Float, { nullable: true, description: 'Expected calibration error over the reliability bins' })
  ece!: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Fraction of forecast buckets in the window that have a backfilled actual',
  })
  coverage!: number | null;

  @Field(() => Boolean, {
    description:
      'True when recent L0 top-1 accuracy dropped more than the drift threshold below the trailing baseline',
  })
  driftFlag!: boolean;

  @Field(() => Int, { description: 'Number of scored forecast buckets in the window' })
  nBuckets!: number;

  @Field(() => [ReliabilityBinType!]!, { description: 'Reliability-diagram bins backing the ECE' })
  reliability!: ReliabilityBinType[];

  static toType(source: PredictionScoreRow): CalibrationScoreType {
    return {
      scoredAt: toIsoString(source.scored_at),
      windowStart: toIsoString(source.window_start),
      windowEnd: toIsoString(source.window_end),
      brier: source.brier ?? null,
      l0Top1Acc: source.l0_top1_acc ?? null,
      l1Top3Acc: source.l1_top3_acc ?? null,
      ece: source.ece ?? null,
      coverage: source.coverage ?? null,
      driftFlag: source.drift_flag,
      nBuckets: source.n_buckets,
      reliability: parseReliability(source.reliability_json).map(ReliabilityBinType.toType),
    };
  }
}

@ObjectType({
  description:
    'HBPE forecast calibration: the latest live-scoring run plus a short trend. IMPORTANT: these metrics ' +
    'measure forecast self-consistency against Qwen-derived behavior labels (see basis), not ground-truth accuracy.',
})
export class PredictionCalibrationType {
  @Field(() => String, {
    description:
      "What the metrics measure — always 'self-consistency-vs-qwen-labels': forecasts are scored against " +
      'actuals the pipeline itself derived from Qwen-labeled events, not independently verified behavior.',
  })
  basis!: string;

  @Field(() => CalibrationScoreType, { nullable: true, description: 'Most recent scoring run, if any' })
  latest!: CalibrationScoreType | null;

  @Field(() => [CalibrationScoreType!]!, {
    description: 'Recent scoring runs, newest first (includes latest)',
  })
  history!: CalibrationScoreType[];

  /** Rows come from CalibrationService.getScores, newest first. */
  static toType(rows: PredictionScoreRow[]): PredictionCalibrationType {
    const history = rows.map(CalibrationScoreType.toType);

    return {
      basis: CALIBRATION_BASIS,
      latest: history[0] ?? null,
      history,
    };
  }
}

function toIsoString(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function parseReliability(value: PredictionScoreRow['reliability_json']): ReliabilityBinRow[] {
  if (value == null) {
    return [];
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;

      return Array.isArray(parsed) ? (parsed as ReliabilityBinRow[]) : [];
    } catch {
      return [];
    }
  }

  return Array.isArray(value) ? value : [];
}
