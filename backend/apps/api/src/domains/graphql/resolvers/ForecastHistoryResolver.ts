import { BadRequestException, UseGuards } from '@nestjs/common';
import { Args, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import { FORECAST_HISTORY_DATE_PATTERN, ForecastHistoryService } from '@ci/domains/predictions';

import { ForecastHistoryType } from '../types/ForecastHistoryType';

/**
 * Egress for past-day forecast history (hbpe.prediction_log joined with its
 * backfilled actuals): the latest prediction issued per 30-minute bucket of a
 * past date, plus the observed L0 class once the nightly actuals backfill has
 * run. Powers the dashboard's past-day heatmap rows and the timeline
 * predicted-vs-actual overlay.
 */
@UseGuards(JwtOrApiKeyAuthGuard)
@Resolver(() => ForecastHistoryType)
export class ForecastHistoryResolver {
  constructor(
    private readonly forecastHistoryService: ForecastHistoryService,
    private readonly featureService: FeatureService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ForecastHistoryResolver.name);
  }

  @Query(() => ForecastHistoryType, {
    nullable: true,
    description:
      'Per-bucket forecast history for a past local date (YYYY-MM-DD): the latest prediction issued ' +
      'for each 30-minute bucket joined with its backfilled actual L0 class.',
  })
  async forecastHistory(
    @Context() context: RequestContext,
    @Args('date', { type: () => String, description: 'Calendar date, formatted YYYY-MM-DD' })
    date: string,
  ): Promise<ForecastHistoryType | null> {
    if (!(await this.featureService.isFeatureEnabled('hbpe'))) {
      return null;
    }

    // Surface malformed input as a GraphQL error rather than a silent null.
    if (!FORECAST_HISTORY_DATE_PATTERN.test(date)) {
      throw new BadRequestException('date must be a calendar date formatted YYYY-MM-DD');
    }

    try {
      const rows = await this.forecastHistoryService.getHistory(toServiceContext(context), date);

      return ForecastHistoryType.toType(date, rows);
    } catch (err) {
      this.logger.error('Forecast history query failed', err instanceof Error ? err : new Error(String(err)));

      return null;
    }
  }
}
