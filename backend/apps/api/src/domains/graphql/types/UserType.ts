import { Field, ObjectType, ID } from '@nestjs/graphql';

import { Node } from './Node';

@ObjectType({ implements: () => [Node] })
export class UserType implements Node {
  @Field(() => ID)
  id!: string;

  @Field(() => String)
  name!: string;

  @Field(() => String)
  email!: string;

  @Field(() => Boolean)
  onboarded!: boolean;
}
