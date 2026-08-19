import { Field, InputType } from '@nestjs/graphql';

/**
 * Undo argument for the soft-delete family: the global id of an entity that was
 * tombstoned by its `delete*` mutation and should be brought back.
 */
@InputType()
export class RestoreByIdInput {
  @Field()
  id!: string;
}
