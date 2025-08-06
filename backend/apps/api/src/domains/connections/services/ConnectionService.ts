import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { LoggerService } from '@ci/common/services/LoggerService';
import type { RequestContext } from '@ci/common/types';
import config from '@ci/configuration';

import { ApiLogEntity } from '../entities/ApiLogEntity';
import { ConnectionEntity } from '../entities/ConnectionEntity';
import { ApiProviderFactory } from '../providers';
import type {
  CreateConnectionDto,
  Connection,
  OAuthTokenResponse,
  UpdateConnectionDto,
  UpdateConnectionCredentialsDto,
} from '../types';

@Injectable()
export class ConnectionService {
  private logger = new LoggerService(ConnectionService.name);

  constructor(
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
    @InjectRepository(ApiLogEntity)
    private readonly apiLogRepository: Repository<ApiLogEntity>,
    private readonly apiProviderFactory: ApiProviderFactory,
  ) {}

  async create(context: RequestContext, data: CreateConnectionDto): Promise<Connection> {
    const { providerId, ...rest } = data;

    this.logger.debug('Creating connection', {
      providerId,
      hasClientId: !!rest.clientid,
      hasClientSecret: !!rest.clientsecret,
      userId: context.userId,
    });

    // Ensure credentials are trimmed when saving
    const sanitizedData = {
      ...rest,
      clientid: rest.clientid?.trim(),
      clientsecret: rest.clientsecret?.trim(),
    };

    const instance = this.connectionRepository.create({
      ...sanitizedData,
      id: uuid7(),
      active: true,
      user: {
        id: context.userId,
      },
      provider: {
        id: providerId,
      },
    });

    const entity = await this.connectionRepository.save(instance);

    this.logger.debug('Connection created', {
      connectionId: entity.id,
      hasClientId: !!entity.clientid,
      hasClientSecret: !!entity.clientsecret,
    });

    return this.findOne(context, entity.id);
  }

  async findAll(context: RequestContext): Promise<Connection[]> {
    const entities = await this.connectionRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
      relations: ['provider'],
    });

    return entities.map((entity) => entity.toConnection());
  }

  async findAllActive(): Promise<Array<Connection & { userId: string }>> {
    const entities = await this.connectionRepository
      .createQueryBuilder('connection')
      .leftJoinAndSelect('connection.provider', 'provider')
      .leftJoinAndSelect('connection.user', 'user')
      .where('connection.active = :active', { active: true })
      .andWhere('connection.accessToken IS NOT NULL')
      .getMany();

    return entities.map((entity) => ({
      ...entity.toConnection(),
      userId: entity.user?.id || 'unknown',
    }));
  }

  async findOne(context: RequestContext, id: string): Promise<Connection> {
    const entity = await this.connectionRepository.findOne({
      where: {
        id,
        user: {
          id: context.userId,
        },
      },
      relations: ['provider'],
    });

    if (entity == null) {
      throw new NotFoundException();
    }

    return entity.toConnection();
  }

  async update(
    context: RequestContext,
    id: string,
    data: UpdateConnectionDto & UpdateConnectionCredentialsDto,
  ): Promise<Connection> {
    const updatePayload: UpdateConnectionDto = {
      ...data,
      clientid: data.clientid?.trim(),
      clientsecret: data.clientsecret?.trim(),
    };

    const result = await this.connectionRepository.update(
      {
        id,
        user: {
          id: context.userId,
        },
      },
      updatePayload,
    );

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    const updated = await this.findOne(context, id);

    return updated;
  }

  async delete(context: RequestContext, id: string): Promise<boolean> {
    const result = await this.connectionRepository.delete({
      id,
      user: {
        id: context.userId,
      },
    });

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    return true;
  }

  async sync(
    context: RequestContext,
    connectionId: string,
  ): Promise<{ success: boolean; message: string; data?: unknown }> {
    const connection = await this.findOne(context, connectionId);

    if (!connection.accessToken) {
      throw new NotFoundException('Connection not authenticated');
    }

    const provider = connection.provider;
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    this.logger.log('Starting manual sync for connection', {
      connectionId,
      providerName: provider.name,
      userId: context.userId,
    });

    try {
      const apiProvider = this.apiProviderFactory.getProvider(provider.id);

      const syncResponse = await apiProvider.sync(connection);

      await this.apiLogRepository.save({
        id: uuid7(),
        content: JSON.stringify(syncResponse),
        connection: {
          id: connectionId,
        },
        user: {
          id: context.userId,
        },
      });

      this.logger.log('Sync completed', {
        connectionId,
        success: syncResponse.success,
        message: syncResponse.message,
      });

      return syncResponse;
    } catch (error) {
      this.logger.error('Sync failed', {
        connectionId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async connect(context: RequestContext, connectionId: string): Promise<{ url: string }> {
    const connection = await this.findOne(context, connectionId);

    if (!connection.clientid) {
      throw new Error('OAuth credentials not configured');
    }

    const provider = connection.provider;

    if (provider == null) {
      throw new Error('Connection not associated with a provider');
    }

    if (provider.tokenHost == null) {
      throw new Error('Provider has no tokenHost specified');
    }

    return {
      url: generateOAuth2RedirectURL({
        authEndpoint: mergeUrls([provider.tokenHost, provider.authorizePath]),
        clientId: connection.clientid,
        callbackUrl: config.auth.oauth.callbackUrl,
        scope: provider.scopes || '',
        state: connectionId,
      }),
    };
  }

  async callback(context: RequestContext, connectionId: string, code: string): Promise<Connection> {
    const connection = await this.findOne(context, connectionId);

    if (connection.clientid == null || connection.clientsecret == null) {
      throw new Error('OAuth credentials not configured');
    }

    const provider = connection.provider;

    if (provider == null) {
      throw new Error('Connection not associated with a provider');
    }

    const tokenEndpoint = mergeUrls([provider.tokenHost, provider.tokenPath]);

    const tokenParams = new URLSearchParams({
      code,
      client_id: connection.clientid,
      client_secret: connection.clientsecret,
      redirect_uri: config.auth.oauth.callbackUrl,
      grant_type: 'authorization_code',
    });

    const tokenResponse = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: tokenParams.toString(),
    });

    if (!tokenResponse.ok) {
      let errorDetails;

      try {
        errorDetails = tokenResponse.json();
      } catch {
        errorDetails = tokenResponse.text();
      }

      this.logger.error('Token exchange failed', {
        status: tokenResponse.status,
        error: errorDetails,
        endpoint: tokenEndpoint,
      });

      throw new Error('Token exchange failed');
    }

    let tokenData: OAuthTokenResponse;

    try {
      tokenData = (await tokenResponse.json()) as OAuthTokenResponse;
    } catch {
      throw new Error('Invalid token response format');
    }

    const expiryDate = tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null;

    return this.update(context, connectionId, {
      accessToken: tokenData.access_token || null,
      refreshToken: tokenData.refresh_token || null,
      tokenExpiry: expiryDate,
    });
  }
}

function mergeUrls(urls: (string | null)[]) {
  const result = new URL('http://placeholder');
  let validResult = false;

  result.hostname = '';

  for (const url of urls) {
    if (url == null) {
      continue;
    }

    let parsedUrl;
    let overrideHost = false;

    try {
      parsedUrl = new URL(url);
      overrideHost = true;
    } catch {
      parsedUrl = new URL(url, 'http://placeholder.com');
    }

    if (overrideHost) {
      result.protocol = parsedUrl.protocol;
      result.hostname = parsedUrl.hostname;
      result.username = parsedUrl.username;
      result.port = parsedUrl.port;

      validResult = true;
    }

    result.pathname = parsedUrl.pathname;
  }

  if (!validResult) {
    throw new Error('No URL contains a valid hostname');
  }

  return result.toString();
}

function generateOAuth2RedirectURL({
  authEndpoint,
  clientId,
  callbackUrl,
  scope,
  state,
  responseType = 'code',
  extraParams = {},
}: {
  authEndpoint: string;
  clientId: string;
  callbackUrl: string;
  scope: string | string[];
  state?: string;
  responseType?: string;
  extraParams?: Record<string, string>;
}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: responseType,
    scope: Array.isArray(scope) ? scope.join(' ') : scope,
    ...(state ? { state } : {}),
    ...extraParams,
  });

  return `${authEndpoint}?${params.toString()}`;
}
