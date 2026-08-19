import { Field, Int, ObjectType } from '@nestjs/graphql';

import { MutationPayload } from './MutationPayload';
import { TagType } from './TagType';

@ObjectType()
export class UpdateTagPayload extends MutationPayload {
  /**
   * The surviving tag. After a merge this is the tag that already held the new
   * label, so its id differs from the one that was edited.
   */
  @Field(() => TagType, { nullable: true })
  tag?: TagType;

  /**
   * The new label was already taken by another of the caller's tags, so the
   * two were collapsed into one and the edited tag no longer exists.
   */
  @Field(() => Boolean)
  merged!: boolean;

  /** Entities re-pointed onto the surviving tag by a merge. Zero otherwise. */
  @Field(() => Int)
  movedEntityCount!: number;

  /** Saved searches whose tag filter was rewritten to follow the rename. */
  @Field(() => Int)
  updatedSavedSearchCount!: number;
}
