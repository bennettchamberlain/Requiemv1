import { Field, ObjectType } from '@nestjs/graphql';

import { EventType } from './EventType';
import { MutationPayload } from './MutationPayload';
import { TaskType } from './TaskType';

@ObjectType()
export class ScheduleTaskPayload extends MutationPayload {
  @Field(() => TaskType, { nullable: true })
  task?: TaskType;

  @Field(() => EventType, { nullable: true })
  event?: EventType;

  @Field(() => String, {
    nullable: true,
    description: 'placed | proposed | already_placed | no_gap | skipped',
  })
  status?: string;
}
