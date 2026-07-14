import { Field, Float, ObjectType } from '@nestjs/graphql';

import type { WeekForecastCluster, WeekForecastDay, WeekForecastResponse } from '@ci/domains/predictions';

import { ProbabilityEntryType } from './ForecastBucketType';

@ObjectType({ description: 'One L1 cluster likely to occur on a forecast day' })
export class WeekForecastClusterType {
  @Field(() => String)
  clusterId!: string;

  @Field(() => String, {
    description: 'Human-readable cluster name (user-specific, discovered from behavior)',
  })
  name!: string;

  @Field(() => String, { description: 'Parent L0 behavioral class (WORK, EXERCISE, ...)' })
  l0Class!: string;

  @Field(() => Float, { description: 'Probability the cluster occurs at least once that day' })
  pOccur!: number;

  @Field(() => [ProbabilityEntryType!]!, {
    description: 'Time-of-day tendency (night/morning/afternoon/evening shares)',
  })
  daypartProbs!: ProbabilityEntryType[];

  @Field(() => Boolean, {
    description: 'True when a booked calendar event pins this cell (known, not predicted)',
  })
  scheduled!: boolean;

  static toType(source: WeekForecastCluster): WeekForecastClusterType {
    return {
      clusterId: source.cluster_id,
      name: source.name,
      l0Class: source.l0_class,
      pOccur: source.p_occur,
      daypartProbs: Object.entries(source.daypart_probs).map(([label, probability]) => ({
        label,
        probability,
      })),
      scheduled: source.scheduled ?? false,
    };
  }
}

@ObjectType({ description: 'Occurrence forecast for a single day of the week horizon' })
export class WeekForecastDayType {
  @Field(() => String, { description: 'ISO date (UTC calendar day)' })
  date!: string;

  @Field(() => String, { description: 'Day-of-week name' })
  dow!: string;

  @Field(() => [WeekForecastClusterType!]!)
  clusters!: WeekForecastClusterType[];

  static toType(source: WeekForecastDay): WeekForecastDayType {
    return {
      date: source.date,
      dow: source.dow,
      clusters: source.clusters.map(WeekForecastClusterType.toType),
    };
  }
}

@ObjectType({ description: 'HBPE week-horizon occurrence forecast (event-level, not bucket occupancy)' })
export class WeekForecastType {
  @Field(() => String)
  horizon!: string;

  @Field(() => String, { description: 'ISO-8601 timestamp when this forecast was generated' })
  generatedAt!: string;

  @Field(() => [WeekForecastDayType!]!)
  days!: WeekForecastDayType[];

  static toType(source: WeekForecastResponse): WeekForecastType {
    return {
      horizon: source.horizon,
      generatedAt: source.generated_at,
      days: source.days.map(WeekForecastDayType.toType),
    };
  }
}
