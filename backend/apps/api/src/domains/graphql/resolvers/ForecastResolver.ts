import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/logging';
import { HbpeService } from '@ci/domains/predictions';
import { PythonFunctionService } from '@ci/domains/python-functions';
import { UserService } from '@ci/domains/user';

import { DueForecastType } from '../types/DueForecastType';
import { ForecastType } from '../types/ForecastType';
import { WeekForecastType } from '../types/WeekForecastType';

@UseGuards(JwtOrApiKeyAuthGuard)
@Resolver(() => ForecastType)
export class ForecastResolver {
  constructor(
    private readonly hbpeService: HbpeService,
    private readonly pythonFunctionService: PythonFunctionService,
    private readonly userService: UserService,
    private readonly featureService: FeatureService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ForecastResolver.name);
  }

  @Query(() => ForecastType, { nullable: true, description: 'Fetch the HBPE day-ahead forecast histogram' })
  async forecast(
    @Context() context: RequestContext,
    @Args('horizon', { type: () => String, nullable: true, defaultValue: '24h' }) horizon: string,
  ): Promise<ForecastType | null> {
    if (!(await this.featureService.isFeatureEnabled('hbpe'))) {
      return null;
    }

    try {
      const response = await this.hbpeService.getForecast(toServiceContext(context), horizon);

      return ForecastType.toType(response);
    } catch (err) {
      this.logger.error('Forecast query failed', err instanceof Error ? err : new Error(String(err)));

      return null;
    }
  }

  @Query(() => WeekForecastType, {
    nullable: true,
    description: 'Fetch the HBPE week-horizon occurrence forecast (per-day cluster probabilities)',
  })
  async weekForecast(
    @Context() context: RequestContext,
    @Args('includeToday', { type: () => Boolean, nullable: true, defaultValue: false })
    includeToday: boolean,
  ): Promise<WeekForecastType | null> {
    if (!(await this.featureService.isFeatureEnabled('hbpe'))) {
      return null;
    }

    try {
      const serviceContext = toServiceContext(context);
      const user = await this.userService.findById(serviceContext, serviceContext.userId);
      const timezone = user?.timezone ?? 'UTC';

      const response = await this.hbpeService.getWeekForecast(serviceContext, includeToday, timezone);

      return WeekForecastType.toType(response);
    } catch (err) {
      this.logger.error('Week forecast query failed', err instanceof Error ? err : new Error(String(err)));

      return null;
    }
  }

  @Query(() => DueForecastType, {
    nullable: true,
    description: 'Fetch HBPE renewal predictions: periodic behaviors coming due or overdue',
  })
  async dueForecast(@Context() context: RequestContext): Promise<DueForecastType | null> {
    if (!(await this.featureService.isFeatureEnabled('hbpe'))) {
      return null;
    }

    try {
      const response = await this.hbpeService.getDueList(toServiceContext(context));

      return DueForecastType.toType(response);
    } catch (err) {
      this.logger.error('Due forecast query failed', err instanceof Error ? err : new Error(String(err)));

      return null;
    }
  }

  @Mutation(() => String, { description: 'Manually trigger the HBPE pipeline for the current user' })
  async triggerHbpe(@Context() context: RequestContext): Promise<string> {
    if (!(await this.featureService.isFeatureEnabled('hbpe'))) {
      return 'disabled';
    }

    if (!context.userId) {
      return 'error';
    }

    try {
      // The nightly pipeline covers cold start too: its bootstrap check trains
      // the model when the checkpoint is missing or stale. Routed through
      // pg-boss so the run gets retries and shows up in the jobs monitor.
      const enqueued = await this.pythonFunctionService.dispatch(
        'hbpe',
        'nightly',
        context.userId,
        {},
        {
          singletonKey: `fn:nightly:${context.userId}:manual`,
        },
      );

      return enqueued ? 'triggered' : 'already_running';
    } catch (err) {
      this.logger.error('HBPE trigger dispatch failed', err instanceof Error ? err : new Error(String(err)));

      return 'error';
    }
  }
}
