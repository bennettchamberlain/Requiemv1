import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import type { ForecastHistoryBucket, ForecastHistoryDay } from '@ci/domains/predictions';

@ObjectType()
export class ForecastHistoryProbType {
  @Field(() => String)
  label!: string;

  @Field(() => Float)
  probability!: number;
}

@ObjectType()
export class ForecastHistoryBucketType {
  @Field(() => Int)
  bucketIndex!: number;

  @Field(() => [ForecastHistoryProbType!]!)
  predictedL0!: ForecastHistoryProbType[];

  @Field(() => String, { nullable: true })
  actualL0!: string | null;
}

@ObjectType({ description: 'One past local day of logged forecast buckets' })
export class ForecastHistoryDayType {
  @Field(() => String)
  date!: string;

  @Field(() => [ForecastHistoryBucketType!]!)
  buckets!: ForecastHistoryBucketType[];

  static toType(source: ForecastHistoryDay): ForecastHistoryDayType {
    return {
      date: source.date,
      buckets: source.buckets.map((bucket: ForecastHistoryBucket) => ({
        bucketIndex: bucket.bucketIndex,
        predictedL0: bucket.predictedL0,
        actualL0: bucket.actualL0,
      })),
    };
  }
}
