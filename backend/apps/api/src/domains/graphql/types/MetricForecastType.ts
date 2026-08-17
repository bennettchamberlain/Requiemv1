import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import type { MetricForecast } from '@ci/domains/daily-metrics';

@ObjectType({ description: 'One forecast day with its q10/q50/q90 band' })
export class MetricForecastPointType {
  @Field(() => String, { description: 'YYYY-MM-DD' })
  date!: string;

  @Field(() => Float)
  q10!: number;

  @Field(() => Float)
  q50!: number;

  @Field(() => Float)
  q90!: number;
}

@ObjectType({ description: 'Seasonal-naive + EWMA forecast of a daily-metrics scalar' })
export class MetricForecastType {
  @Field(() => String)
  metric!: string;

  @Field(() => String, { description: 'OK, NOT_ENOUGH_SIGNAL, or UNKNOWN_METRIC' })
  status!: string;

  @Field(() => Float, { description: 'Fraction of the 90-day history window that had a value' })
  coverage!: number;

  @Field(() => Int)
  horizonDays!: number;

  @Field(() => [MetricForecastPointType!]!)
  points!: MetricForecastPointType[];

  static toType(source: MetricForecast): MetricForecastType {
    return {
      metric: source.metric,
      status: source.status,
      coverage: source.coverage,
      horizonDays: source.horizonDays,
      points: source.points.map((point) => ({ ...point })),
    };
  }
}
