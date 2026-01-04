import { Field, ID, ObjectType } from '@nestjs/graphql';

import { type BrowserActivity } from '@ci/domains/browser-activity';

import { GlobalUID } from './GlobalUID';
import { Node } from './Node';

@ObjectType({ implements: () => [Node] })
export class BrowserActivityType implements Node {
  __typename = BrowserActivityType.name;

  __source!: BrowserActivity;

  @Field(() => ID)
  id!: string;

  @Field(() => String)
  url!: string;

  @Field(() => String, { nullable: true })
  title!: string | null;

  @Field(() => String, { nullable: true })
  actionType!: string | null;

  @Field(() => Number, { nullable: true })
  duration!: number | null;

  @Field(() => Number, { nullable: true })
  scrollDepth!: number | null;

  @Field(() => Date)
  time!: Date;

  static toType(activity: BrowserActivity): BrowserActivityType {
    return {
      __typename: BrowserActivityType.name,
      __source: activity,
      id: GlobalUID.encode('browser-activity', activity.id),
      url: activity.url,
      title: activity.title ?? null,
      actionType: activity.action_type ?? null,
      duration: activity.duration_seconds ?? null,
      scrollDepth: activity.scroll_depth_percent ?? null,
      time: activity.time,
    };
  }
}
