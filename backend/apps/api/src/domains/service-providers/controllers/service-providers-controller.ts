import {
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { Context } from '@ci/common/decorators';
import type { RequestContext } from '@ci/common/types';

@Controller('service-provider')
export class ServiceProviderController {
  constructor(private readonly serviceProviderService: ServiceProviderService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get()
  findAll(@Context() context: RequestContext) {
    return this.serviceProviderService.findAll(context);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':id')
  findOne(@Context() context: RequestContext, @Param('id') id: string) {
    return this.serviceProviderService.findOne(context, id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post(':id/enable')
  async getPresignedLink(@Context() context: RequestContext, @Param('id') id: string) {
    return { "todo":"todo" };
  }

}
