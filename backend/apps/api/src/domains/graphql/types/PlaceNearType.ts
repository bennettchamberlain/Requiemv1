import { Field, Float, ObjectType } from '@nestjs/graphql';

import { PlaceType } from './PlaceType';

/** One placesNear result: the place plus its distance from the query point. */
@ObjectType()
export class PlaceNearType {
  @Field(() => PlaceType)
  place!: PlaceType;

  @Field(() => Float)
  distanceMeters!: number;
}
