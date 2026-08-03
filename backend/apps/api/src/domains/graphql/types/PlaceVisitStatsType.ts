import { Field, Int, ObjectType } from '@nestjs/graphql';

import type { PlaceVisitStats } from '@ci/domains/memory';

/**
 * Aggregated visit stats for a place, derived from events linked via
 * events.location_entity_id.
 */
@ObjectType()
export class PlaceVisitStatsType {
  @Field(() => Int)
  visitCount!: number;

  @Field(() => Date, { nullable: true })
  firstVisitAt!: Date | null;

  @Field(() => Date, { nullable: true })
  lastVisitAt!: Date | null;

  static toType(stats: PlaceVisitStats): PlaceVisitStatsType {
    return {
      visitCount: stats.visitCount,
      firstVisitAt: stats.firstVisitAt,
      lastVisitAt: stats.lastVisitAt,
    };
  }
}
