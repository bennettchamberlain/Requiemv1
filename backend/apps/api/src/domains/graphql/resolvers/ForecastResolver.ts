import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { JwtAuthGuard } from '@ci/common/guards';
import { HbpeService } from '@ci/domains/predictions';

import { ForecastType } from '../types/ForecastType';

@UseGuards(JwtAuthGuard)
@Resolver(() => ForecastType)
export class ForecastResolver {
  constructor(
    private readonly hbpeService: HbpeService,
    private readonly featureService: FeatureService,
  ) {}

  @Query(() => ForecastType, { nullable: true, description: 'Fetch the HBPE day-ahead forecast histogram' })
  async forecast(
    @Args('horizon', { type: () => String, nullable: true, defaultValue: '24h' }) horizon: string,
  ): Promise<ForecastType | null> {
    if (!(await this.featureService.isFeatureEnabled('hbpe'))) {
      return null;
    }

    try {
      const response = await this.hbpeService.getForecast(horizon);

      return ForecastType.toType(response);
    } catch {
      return null;
    }
  }

  @Mutation(() => Boolean, { description: 'Manually trigger the HBPE pipeline for the current user' })
  async triggerHbpe(@Context() context: RequestContext): Promise<boolean> {
    if (!(await this.featureService.isFeatureEnabled('hbpe'))) {
      return false;
    }

    if (!context.userId) {
      return false;
    }

    return this.hbpeService.triggerPipeline(context.userId);
  }
}
