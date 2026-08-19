import { Field, Int, ObjectType } from '@nestjs/graphql';

import { PersonType } from './PersonType';

/**
 * A group of live Person entities that look like the same human: they share a
 * normalized email, phone, or (weaker) display name. Suggestions for the merge
 * review UI — merging is always a user decision.
 */
@ObjectType()
export class PersonDuplicateGroupType {
  /** What the group collapsed on: email | phone | name. */
  @Field(() => String)
  reason!: string;

  /** The shared normalized value. */
  @Field(() => String)
  value!: string;

  @Field(() => [PersonType])
  people!: PersonType[];

  /**
   * How many people share this value in total.
   *
   * `people` is capped, so a call-log heading shared by 899 rows arrives as six
   * members and `totalPeople: 899` — the UI has to say so rather than imply the
   * group is small.
   */
  @Field(() => Int)
  totalPeople!: number;
}
