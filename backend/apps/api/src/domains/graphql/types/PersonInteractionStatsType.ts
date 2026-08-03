import { Field, Int, ObjectType } from '@nestjs/graphql';

import type { PersonInteractionStats } from '@ci/domains/memory';

/**
 * Activity aggregates for a person: events they appear in (organizer or
 * participant), communications they sent or received, and the most recent of
 * either.
 */
@ObjectType()
export class PersonInteractionStatsType {
  @Field(() => Int)
  eventCount!: number;

  @Field(() => Int)
  communicationCount!: number;

  @Field(() => Date, { nullable: true })
  lastInteractionAt!: Date | null;

  static toType(stats: PersonInteractionStats): PersonInteractionStatsType {
    return {
      eventCount: stats.eventCount,
      communicationCount: stats.communicationCount,
      lastInteractionAt: stats.lastInteractionAt,
    };
  }
}
