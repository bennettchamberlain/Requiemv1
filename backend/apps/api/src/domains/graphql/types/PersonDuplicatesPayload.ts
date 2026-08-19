import { Field, Int, ObjectType } from '@nestjs/graphql';

import { PersonDuplicateGroupType } from './PersonDuplicateGroupType';

/**
 * One page of duplicate-person suggestions, plus how many there are.
 *
 * The list used to be returned bare and capped at 25, so a library with
 * thousands of duplicate groups looked like it had 25 — the count is what makes
 * the cap honest, and `hasMore` is what makes it pageable.
 */
@ObjectType()
export class PersonDuplicatesPayload {
  @Field(() => [PersonDuplicateGroupType])
  groups!: PersonDuplicateGroupType[];

  /**
   * Candidate groups matching the filter across the whole library.
   *
   * Counted before rejected pairs are dropped from each group, so it can
   * slightly overstate what a full walk would yield — it is the size of the
   * queue, not a promise about every page.
   */
  @Field(() => Int)
  totalCount!: number;

  @Field(() => Boolean)
  hasMore!: boolean;
}
