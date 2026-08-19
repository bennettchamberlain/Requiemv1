import { Field, ID, InputType } from '@nestjs/graphql';

@InputType()
export class MergePeopleInput {
  /** People to merge away (become tombstones pointing at the target). */
  @Field(() => [ID])
  sourceIds!: string[];

  /** The canonical person that survives. */
  @Field(() => ID)
  targetId!: string;
}
