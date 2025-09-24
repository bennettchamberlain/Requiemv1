import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { RequestContext } from '@ci/common/types';

import { ConnectionService } from '../services/ConnectionService';
import { ProviderService } from '../services/ProviderService';

@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly providerService: ProviderService,
    private readonly connectionService: ConnectionService,
  ) {}

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
    const provider = await this.providerService.findOne(id);

    const connection = await this.connectionService.create(context, {
      providerId: provider.id,
      name: provider.name ?? 'My Connection', // TODO: We shouldn't require a name here.
    });

    return {
      redirectUrl: `https://example.com/link/to/${id}`,
      context,
      connection,
    };
  }
}
