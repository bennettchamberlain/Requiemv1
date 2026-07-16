import { Field, Int, ObjectType } from '@nestjs/graphql';

import type { ForecastHistoryBucketRow } from '@ci/domains/predictions';

import { ProbabilityEntryType } from './ForecastBucketType';

const BUCKET_MINUTES = 30;

@ObjectType({
  description:
    'One 30-minute bucket of a past-day forecast: the latest prediction issued for the bucket ' +
    'joined with the observed (backfilled) actual L0 class',
})
export class ForecastHistoryBucketType {
  @Field(() => Int)
  bucketIndex!: number;

  @Field(() => String, { description: 'ISO-8601 start time for this bucket' })
  startTime!: string;

  @Field(() => [ProbabilityEntryType!]!, {
    description: 'Predicted L0 class distribution (highest probability first)',
  })
  predictedL0!: ProbabilityEntryType[];

  @Field(() => String, {
    nullable: true,
    description: 'Observed L0 class for the bucket, null when the actual has not been backfilled',
  })
  actualL0!: string | null;

  static toType(source: ForecastHistoryBucketRow): ForecastHistoryBucketType {
    const horizonStart = toDate(source.horizon_start);
    const startTime = new Date(horizonStart.getTime() + source.bucket_index * BUCKET_MINUTES * 60_000);

    return {
      bucketIndex: source.bucket_index,
      startTime: startTime.toISOString(),
      predictedL0: toSortedEntries(source.l0_probs),
      actualL0: source.actual_l0 ?? null,
    };
  }
}

@ObjectType({
  description:
    'Past-day forecast history: for each 30-minute bucket of the requested date, the latest ' +
    'prediction issued for that bucket joined with its backfilled actual. Powers the past-day ' +
    'heatmap rows and the predicted-vs-actual timeline overlay.',
})
export class ForecastHistoryType {
  @Field(() => String, { description: 'The requested forecast date (YYYY-MM-DD)' })
  date!: string;

  @Field(() => [ForecastHistoryBucketType!]!, {
    description: '48 buckets when a forecast was issued for the date; only logged buckets are returned',
  })
  buckets!: ForecastHistoryBucketType[];

  static toType(date: string, rows: ForecastHistoryBucketRow[]): ForecastHistoryType {
    return {
      date,
      buckets: rows.map(ForecastHistoryBucketType.toType),
    };
  }
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Coerce a JSONB probability column (object, or a JSON string from drivers
 * without the JSON typecaster) to sorted {label, probability} entries,
 * highest probability first with a deterministic label tie-break.
 */
function toSortedEntries(probs: Record<string, number> | string): ProbabilityEntryType[] {
  let map: Record<string, number> = {};

  if (typeof probs === 'string') {
    try {
      const parsed = JSON.parse(probs) as unknown;

      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        map = parsed as Record<string, number>;
      }
    } catch {
      map = {};
    }
  } else if (probs !== null && typeof probs === 'object') {
    map = probs;
  }

  return Object.entries(map)
    .map(([label, probability]) => ({ label, probability: Number(probability) }))
    .sort((a, b) => b.probability - a.probability || a.label.localeCompare(b.label));
}
