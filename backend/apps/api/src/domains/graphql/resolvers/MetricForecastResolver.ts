import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { MetricForecastService } from '@ci/domains/insights';

import { MetricForecastType } from '../types/MetricForecastType';

@UseGuards(JwtOrApiKeyAuthGuard)
@Resolver(() => MetricForecastType)
export class MetricForecastResolver {
  constructor(private readonly metricForecastService: MetricForecastService) {}

  @Query(() => MetricForecastType, {
    description:
      'q10/q50/q90 forecast of a Daily Feature Store metric (NOT_ENOUGH_SIGNAL when history is too thin)',
  })
  async metricForecast(
    @Context() context: RequestContext,
    @Args('metric', { type: () => String }) metric: string,
    @Args('days', { type: () => Int, nullable: true, defaultValue: 3 }) days: number,
  ): Promise<MetricForecastType> {
    const forecast = await this.metricForecastService.forecast(toServiceContext(context), metric, days);

    return MetricForecastType.toType(forecast);
  }
}
