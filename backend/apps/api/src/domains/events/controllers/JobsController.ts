import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { Context, type RequestContext } from '@ci/common/context/';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';

import { JobDashboardDto, JobMonitorService } from '../services/JobMonitorService';
import { JobHistoryDto, JobListDto, JobQueryService } from '../services/JobQueryService';
import { JOB_CATEGORIES, JOB_TYPES } from '../taxonomy';

@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobMonitorService: JobMonitorService,
    private readonly jobQueryService: JobQueryService,
  ) {}

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('dashboard')
  getDashboard(@Context() context: RequestContext): Promise<JobDashboardDto> {
    return this.jobMonitorService.getDashboard(context);
  }

  /**
   * The queryable job list behind the dashboard table.
   *
   * All filters are optional and compose. `state` accepts pg-boss's own states
   * plus the synthetic `dead-letter`, which selects the DLQ copies rather than a
   * state — they are stored as `created`, so without it they are unfindable.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get()
  list(
    @Context() context: RequestContext,
    @Query('state') state?: string,
    @Query('queue') queue?: string,
    @Query('category') category?: string,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<JobListDto> {
    return this.jobQueryService.list(context, {
      state,
      queue,
      category,
      search,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /**
   * Time series for the charts, out of `ci.job_metrics`.
   *
   * Not derivable from pg-boss: its tables hold roughly 36 hours of working set
   * and are pruned continuously, so anything older exists only because the
   * collector sampled it.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('history')
  history(
    @Context() context: RequestContext,
    @Query('hours') hours?: string,
    @Query('queue') queue?: string,
  ): Promise<JobHistoryDto> {
    return this.jobQueryService.history(context, {
      windowHours: hours ? Number(hours) : undefined,
      queue,
    });
  }

  /**
   * The job taxonomy: what every event name means and which part of the
   * appliance it belongs to. Served so the UI's labels and its category filter
   * come from one source rather than a second copy in the frontend.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('types')
  types(): {
    categories: string[];
    types: Record<
      string,
      { label: string; category: string; description: string; interactive: boolean }
    >;
  } {
    return {
      categories: Object.values(JOB_CATEGORIES),
      types: Object.fromEntries(
        Object.entries(JOB_TYPES).map(([event, descriptor]) => [
          event,
          {
            label: descriptor.label,
            category: descriptor.category,
            description: descriptor.description,
            interactive: Boolean(descriptor.interactive),
          },
        ]),
      ),
    };
  }
}
