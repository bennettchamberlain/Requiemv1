import { Field, ObjectType } from '@nestjs/graphql';

import { Edge } from './Edge';
import { AnswerType } from './AnswerType';

@ObjectType({ implements: () => [Edge] })
export class AnswerEdge implements Edge {
  @Field(() => String)
  cursor!: string;

  @Field(() => AnswerType)
  node!: AnswerType;
}
