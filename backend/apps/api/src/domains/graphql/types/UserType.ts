import { Field, ObjectType, ID } from '@nestjs/graphql';

import { type User } from '@ci/domains/user';

import { GlobalUID } from './GlobalUID';
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

  static fromEntity(user: User): UserType {
    return {
      id: GlobalUID.toGUID('user', user.id),
      name: user.name,
      email: user.email,
      onboarded: user.onboarded,
    };
  }
}
