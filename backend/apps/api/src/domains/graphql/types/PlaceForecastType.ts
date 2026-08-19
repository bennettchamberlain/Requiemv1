import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import type { PlaceForecastItem } from '@ci/domains/predictions';

@ObjectType({
  description: 'A likely next place from the stay-point transition model (recency-decayed, hour/dow backoff)',
})
export class PlaceForecastItemType {
  @Field(() => String, { nullable: true })
  clusterId!: string | null;

  @Field(() => Float)
  lat!: number;

  @Field(() => Float)
  lng!: number;

  @Field(() => Int)
  visits!: number;

  @Field(() => Float)
  share!: number;

  @Field(() => String, { nullable: true })
  lastSeen!: string | null;

  @Field(() => String, { nullable: true })
  label!: string | null;

  @Field(() => Float)
  probability!: number;

  @Field(() => String, { nullable: true })
  backoffLevel!: string | null;

  static toType(source: PlaceForecastItem): PlaceForecastItemType {
    return { ...source };
  }
}
