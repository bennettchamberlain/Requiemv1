import { Controller, Get, InternalServerErrorException, Param, Post, UseGuards } from '@nestjs/common';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';

import { ConnectionService } from '../services/ConnectionService';
import { ProviderService } from '../services/ProviderService';

@Controller('providers')
export class ProvidersController {
  private readonly logger = new LoggerService(this.constructor.name);

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

    const clientIdVariable = `${provider.name?.toUpperCase()}_CLIENT_ID`;
    const clientSecretVariable = `${provider.name?.toUpperCase()}_CLIENT_SECRET`;

    // TODO:
    //   These are stand-in variables for user settings with fallback defaults.
    //   We need to eventually replace this with a more robust system where we're
    //   POST-ing to a gateway with protected keys, or a local API endpoint with
    //   user-specified key overrides.
    const clientId = process.env[clientIdVariable];
    const clientSecret = process.env[clientSecretVariable];

    if (!clientId) {
      this.logger.error(`Expected environment variable ${clientIdVariable} not specified`);

      throw new InternalServerErrorException('Client id not configured for provider');
    }

    if (!clientSecret) {
      this.logger.error(`Expected environment variable ${clientSecretVariable} not specified`);

      throw new InternalServerErrorException('Client secret not configured for provider');
    }

    const connection = await this.connectionService.create(context, {
      providerId: provider.id,
      name: provider.name ?? 'My Connection', // TODO: We shouldn't require a name here.
      clientid: clientId,
      clientsecret: clientSecret,
    });

    return {
      redirectUrl: `https://example.com/link/to/${id}`,
      context,
      connection,
    };
  }
}
