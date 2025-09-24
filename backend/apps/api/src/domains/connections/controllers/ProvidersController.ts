import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';

import { ProviderService } from '../services/ProviderService';

@Controller('providers')
export class ProvidersController {
  constructor(private readonly providerService: ProviderService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll() {
    return this.providerService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.providerService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id')
  async connect(@Context() context: RequestContext, @Param('id') id: string) {
    return {
      redirectUrl: `https://example.com/link/to/${id}`,
      context,
    };
  }
}
