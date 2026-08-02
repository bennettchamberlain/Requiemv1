import { Field, ObjectType } from '@nestjs/graphql';

import { MutationPayload } from './MutationPayload';
import { TaskType } from './TaskType';

@ObjectType()
export class UpdateTaskPayload extends MutationPayload {
  @Field(() => TaskType, { nullable: true })
  task?: TaskType;
}
