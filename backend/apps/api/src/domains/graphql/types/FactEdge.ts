import { Field, ObjectType } from '@nestjs/graphql';

import { Edge } from './Edge';
import { FactType } from './FactType';

@ObjectType({ implements: () => [Edge] })
export class FactEdge implements Edge {
  @Field(() => String)
  cursor!: string;

  @Field(() => FactType)
  node!: FactType;
}
