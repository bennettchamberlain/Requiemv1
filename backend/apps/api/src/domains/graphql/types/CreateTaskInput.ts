import { Field, GraphQLISODateTime, ID, InputType, Int } from '@nestjs/graphql';

import { TaskStatusEnum } from './TaskType';

@InputType()
export class CreateTaskInput {
  @Field()
  title!: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true })
  notes?: string;

  @Field(() => TaskStatusEnum, { nullable: true })
  status?: TaskStatusEnum;

  @Field(() => Int, { nullable: true, description: '0 (highest) to 5 (lowest). Defaults to 3.' })
  priority?: number;

  @Field(() => ID, { nullable: true })
  parentId?: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  dueAt?: Date;

  @Field({ nullable: true, description: 'Wall-clock `HH:MM`, user timezone. Zoneless.' })
  taskTime?: string;

  @Field({ nullable: true, description: 'User-local calendar date, `YYYY-MM-DD`.' })
  scheduledFor?: string;

  @Field({ nullable: true, description: 'User-local calendar date, `YYYY-MM-DD`.' })
  deferUntil?: string;

  @Field(() => Int, { nullable: true })
  estimatedMinutes?: number;
}
