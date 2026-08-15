import { Field, InputType } from '@nestjs/graphql';

@InputType({
  description:
    'Optional filters applied to the activity heatmap — mirrors the Memory explorer search filters.',
})
export class ActivityTimelineFiltersInput {
  @Field(() => [String], { nullable: true, description: 'Include only these indexable entity types' })
  includeTypes?: string[];

  @Field(() => [String], { nullable: true, description: 'Exclude these indexable entity types' })
  excludeTypes?: string[];

  @Field(() => [String], { nullable: true, description: 'Restrict to these event types (How filter)' })
  eventTypes?: string[];

  @Field(() => [String], { nullable: true, description: 'Restrict to events mentioning these people' })
  people?: string[];

  @Field(() => [String], { nullable: true, description: 'Restrict to events at these places' })
  places?: string[];

  @Field(() => [String], { nullable: true, description: 'Restrict to events from these connectors' })
  connectors?: string[];

  @Field(() => [String], { nullable: true, description: 'Restrict to entities carrying these tags' })
  tags?: string[];

  @Field(() => String, { nullable: true, description: 'Free-text search query' })
  query?: string;
}
