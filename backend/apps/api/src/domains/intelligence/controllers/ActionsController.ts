import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';

import { Context, type RequestContext, toServiceContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';

import { ActionService } from '../services/ActionService';

@Controller('actions')
export class ActionsController {
  constructor(
    private readonly actionService: ActionService,
    private readonly featureService: FeatureService,
  ) {}

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get()
  async findAll(@Context() context: RequestContext) {
    if (!(await this.featureService.isFeatureEnabled('actions'))) {
      return [];
    }

    const serviceContext = toServiceContext(context);

    return this.actionService.findAll(serviceContext);
  }

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get(':id')
  async findOne(@Context() context: RequestContext, @Param('id') id: string) {
    if (!(await this.featureService.isFeatureEnabled('actions'))) {
      throw new NotFoundException();
    }

    const serviceContext = toServiceContext(context);

    return this.actionService.findById(serviceContext, id);
  }
}
