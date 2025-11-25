import {
  Controller,
  Get,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { Context } from '@ci/common/decorators';
import { JwtAuthGuard } from '@ci/common/guards';
import { LoggerService } from '@ci/common/services';
import { RequestContext } from '@ci/common/types';

import { ClientFactory } from '../clients';
import { ConnectionService } from '../services/ConnectionService';
import { ProviderService } from '../services/ProviderService';

@Controller('providers')
export class ProvidersController {
  private readonly logger = new LoggerService(this.constructor.name);

  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly connectionService: ConnectionService,
    private readonly providerService: ProviderService,
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
    const serviceContext = {
      userId: context.userId!,
    };

    const provider = await this.providerService.findOne(id);

    if (provider == null) {
      this.logger.log('Attmpted to connect to a provider that does not exist');

      throw new NotFoundException();
    }

    const client = this.clientFactory.getClientByProviderId(id);

    if (client == null) {
      this.logger.log('Attmpted to create a connection without an associated client');

      throw new InternalServerErrorException();
    }

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

    const connection = await this.connectionService.create(serviceContext, {
      providerId: provider.id,
      name: provider.name ?? 'My Connection', // TODO: We shouldn't require a name here.
      clientid: clientId,
      clientsecret: clientSecret,
      schedule: '1 hour',
    });

    const authorizationUrl = await client.getAuthorizationUrl(connection);

    return {
      authorizationUrl,
    };
  }
}
