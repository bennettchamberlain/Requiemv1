import { UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { ActivityTimelineService } from '@ci/domains/activity';
import type { IndexableEntity } from '@ci/domains/search-next';

import { ActivityBucketType } from '../types/ActivityBucketType';
import { ActivityTimelineFiltersInput } from '../types/ActivityTimelineFiltersInput';

@UseGuards(JwtOrApiKeyAuthGuard)
@Resolver(() => ActivityBucketType)
export class ActivityResolver {
  constructor(private readonly activityTimelineService: ActivityTimelineService) {}

  @Query(() => [ActivityBucketType], {
    description:
      'Precomputed activity counts per local calendar day, with day boundaries in the user profile timezone. Eventually consistent: refreshed from the source tables every 15 minutes. When filters are supplied, counts reflect the same Memory explorer constraints as the search results.',
  })
  async activityTimeline(
    @Context() context: RequestContext,
    @Args('start', { type: () => String, description: 'Inclusive first day, yyyy-MM-dd' }) start: string,
    @Args('end', { type: () => String, description: 'Inclusive last day, yyyy-MM-dd' }) end: string,
    @Args('filters', {
      type: () => ActivityTimelineFiltersInput,
      nullable: true,
      description: 'Optional Memory explorer filters (entity types, tags, who/where/how, search query)',
    })
    filters?: ActivityTimelineFiltersInput,
  ): Promise<ActivityBucketType[]> {
    const counts = await this.activityTimelineService.getDailyCounts(toServiceContext(context), start, end, {
      includeTypes: filters?.includeTypes as IndexableEntity[] | undefined,
      excludeTypes: filters?.excludeTypes as IndexableEntity[] | undefined,
      eventTypes: filters?.eventTypes,
      connectors: filters?.connectors,
      people: filters?.people,
      places: filters?.places,
      tags: filters?.tags,
      query: filters?.query,
    });

    return counts.map(ActivityBucketType.toType);
  }
}
