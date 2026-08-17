import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import type { PlaceForecastItem } from '@ci/domains/predictions';

@ObjectType({ description: 'A likely next place from recent stay cells' })
export class PlaceForecastItemType {
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

  static toType(source: PlaceForecastItem): PlaceForecastItemType {
    return { ...source };
  }
}
