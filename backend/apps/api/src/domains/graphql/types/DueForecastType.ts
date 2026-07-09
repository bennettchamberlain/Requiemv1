import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import type { DueItem, DueResponse } from '@ci/domains/predictions';

@ObjectType({ description: 'A periodic behavior and when it is next expected (renewal prediction)' })
export class DueItemType {
  @Field(() => String)
  clusterId!: string;

  @Field(() => String, { description: 'Human-readable cluster name' })
  name!: string;

  @Field(() => String, { description: 'Parent L0 behavioral class' })
  l0Class!: string;

  @Field(() => String, { description: 'ISO date of the last observed occurrence' })
  lastSeen!: string;

  @Field(() => Int)
  daysSinceLast!: number;

  @Field(() => Float)
  medianIntervalDays!: number;

  @Field(() => Float, { description: 'Days until due (negative = past the median interval)' })
  dueInDays!: number;

  @Field(() => [Float!]!, { description: 'Credible due window [earliest, latest] in days from now' })
  window!: number[];

  @Field(() => Boolean, { description: 'True once the gap exceeds the p90 inter-arrival interval' })
  overdue!: boolean;

  @Field(() => Float, { description: 'Periodicity confidence in [0,1]' })
  confidence!: number;

  static toType(source: DueItem): DueItemType {
    return {
      clusterId: source.cluster_id,
      name: source.name,
      l0Class: source.l0_class,
      lastSeen: source.last_seen,
      daysSinceLast: source.days_since_last,
      medianIntervalDays: source.median_interval_days,
      dueInDays: source.due_in_days,
      window: source.window,
      overdue: source.overdue,
      confidence: source.confidence,
    };
  }
}

@ObjectType({ description: 'HBPE renewal predictions: periodic behaviors coming due or overdue' })
export class DueForecastType {
  @Field(() => String, { description: 'ISO-8601 timestamp when this list was generated' })
  generatedAt!: string;

  @Field(() => [DueItemType!]!)
  due!: DueItemType[];

  static toType(source: DueResponse): DueForecastType {
    return {
      generatedAt: source.generated_at,
      due: source.due.map(DueItemType.toType),
    };
  }
}
