import { Field, ObjectType } from '@nestjs/graphql';

import { PersonType } from './PersonType';

@ObjectType()
export class MergePeoplePayload {
  @Field()
  success!: boolean;

  /** The surviving canonical person after the merge. */
  @Field(() => PersonType, { nullable: true })
  person?: PersonType;
}
