import { Field, ObjectType } from '@nestjs/graphql';

import { PersonType } from './PersonType';

@ObjectType()
export class PersonEdge {
  @Field(() => String)
  cursor!: string;

  @Field(() => PersonType)
  node!: PersonType;
}
