import { Field, ObjectType } from '@nestjs/graphql';

import { PlaceType } from './PlaceType';
import { Edge } from './Edge';

@ObjectType({ implements: () => [Edge] })
export class PlaceEdge implements Edge {
  @Field(() => String)
  cursor!: string;

  @Field(() => PlaceType)
  node!: PlaceType;
}
