import { UseGuards } from '@nestjs/common';
import { Args, Int, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import { PlaceTransitionService } from '@ci/domains/insights';

import { PlaceForecastType } from '../types/PlaceForecastType';

@UseGuards(JwtOrApiKeyAuthGuard)
@Resolver(() => PlaceForecastType)
export class PlaceForecastResolver {
  constructor(
    private readonly placeTransitionService: PlaceTransitionService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PlaceForecastResolver.name);
  }

  @Query(() => PlaceForecastType, {
    description: 'Top-k next-place forecast from the transition model (logged for later scoring)',
  })
  async placeForecast(
    @Context() context: RequestContext,
    @Args('horizonHours', { type: () => Int, nullable: true, defaultValue: 4 }) horizonHours: number,
    @Args('k', { type: () => Int, nullable: true, defaultValue: 5 }) k: number,
  ): Promise<PlaceForecastType> {
    const forecast = await this.placeTransitionService.predictNext(toServiceContext(context), {
      horizonHours,
      k,
    });

    return PlaceForecastType.toType(forecast);
  }

  @Mutation(() => String, {
    description: 'Rebuild place clusters + transitions from ci.position for the current user',
  })
  async rebuildPlaces(@Context() context: RequestContext): Promise<string> {
    const result = await this.placeTransitionService.rebuild(toServiceContext(context));

    return `ok: ${result.clusters} clusters, ${result.transitions} transitions`;
  }
}
