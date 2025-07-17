import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import type { RequestContext } from '@ci/common/types';

import { ConnectionEntity } from '../entities/ConnectionEntity';
import type { CreateConnectionDto, Connection, UpdateConnectionDto } from '../types';

import { LoggerService } from '@ci/common/services/LoggerService';
import { AuthorizationCode } from 'simple-oauth2';

@Injectable()
export class ConnectionService {

  private logger = new LoggerService(ConnectionService.name);

  constructor(
    @InjectRepository(ConnectionEntity)
    private readonly connectionRepository: Repository<ConnectionEntity>,
  ) {}

  async create(context: RequestContext, data: CreateConnectionDto): Promise<Connection> {
    const { providerId, ...rest } = data;

    const instance = this.connectionRepository.create({
      ...rest,
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

  async update(context: RequestContext, id: string, data: UpdateConnectionDto): Promise<Connection> {
    const result = await this.connectionRepository.update(
      {
        id,
        user: {
          id: context.userId,
        },
      },
      data,
    );

    if (result.affected === 0) {
      throw new NotFoundException();
    }

    return this.findOne(context, id);
  }

  async activate(context: RequestContext, id: string): Promise<Connection> {
    return this.update(context, id, { active: true });
  }

  async deactivate(context: RequestContext, id: string): Promise<Connection> {
    return this.update(context, id, { active: false });
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

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

  async connect(context: RequestContext, connectionId: string): Promise<{ url: string }> {
    const connection = await this.findOne(context, connectionId);
    
    if (!connection.clientid || !connection.clientsecret) {
      throw new NotFoundException('OAuth2 credentials not configured');
    }

    // Get provider OAuth2 configuration
    const provider = connection.provider;
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    // Create OAuth2 client based on provider configuration
    // This is a generic implementation that works with any OAuth2 provider
    const client = new AuthorizationCode({
      client: {
        id: connection.clientid,
        secret: connection.clientsecret,
      },
      auth: {
        tokenHost: provider.tokenHost || 'https://oauth2.googleapis.com',
        tokenPath: provider.tokenPath || '/token',
        authorizePath: provider.authorizePath || '/o/oauth2/v2/auth',
      },
    });

    const authorizationUri = client.authorizeURL({
      redirect_uri: `${process.env.API_URL || 'http://dev.companionintelligence.com'}/api/connections/callback`,
      scope: provider.scopes || '',
      state: connectionId, // Pass connection ID in state to identify it in callback
    });

    return { url: authorizationUri };
  }

  async callback(context: RequestContext): Promise<any> {
    this.logger.debug('OAuth2 callback received', context.query);

    if (!context.query || !context.query.code || !context.query.state) {
      this.logger.error('OAuth2 callback missing code or state');
      throw new NotFoundException('Invalid callback parameters');
    }

    const connectionId = context.query.state as string;
    const code = context.query.code as string;

    try {
      // Get the connection without user context (since this is an OAuth callback)
      const entity = await this.connectionRepository.findOne({
        where: { id: connectionId },
        relations: ['provider', 'user'],
      });

      if (!entity) {
        throw new NotFoundException('Connection not found');
      }

      const connection = entity.toConnection();
      
      if (!connection.clientid || !connection.clientsecret) {
        throw new NotFoundException('OAuth2 credentials not configured');
      }

      const provider = connection.provider;
      if (!provider) {
        throw new NotFoundException('Provider not found');
      }

      // Create OAuth2 client
      const client = new AuthorizationCode({
        client: {
          id: connection.clientid,
          secret: connection.clientsecret,
        },
        auth: {
          tokenHost: provider.tokenHost || 'https://oauth2.googleapis.com',
          tokenPath: provider.tokenPath || '/token',
          authorizePath: provider.authorizePath || '/o/oauth2/v2/auth',
        },
      });

      // Exchange code for tokens
      const tokenParams = {
        code,
        redirect_uri: `${process.env.API_URL || 'http://dev.companionintelligence.com'}/api/connections/callback`,
      };

      const accessToken = await client.getToken(tokenParams);

      // Store tokens in the connection entity
      await this.connectionRepository.update(
        { id: connectionId },
        {
          accessToken: accessToken.token.access_token,
          refreshToken: accessToken.token.refresh_token,
          tokenExpiry: accessToken.token.expires_at,
        },
      );

      // Redirect to frontend success page
      const frontendUrl = process.env.FRONTEND_URL || 'http://dev.companionintelligence.com';
      return {
        redirect: `${frontendUrl}/connections?oauth=success&connectionId=${connectionId}`,
      };
    } catch (error) {
      this.logger.error('OAuth2 token exchange failed', error);
      throw new NotFoundException('Failed to complete OAuth2 flow');
    }
  }

  async makeApiRequest(context: RequestContext, connectionId: string, endpoint: string, options?: any): Promise<any> {
    const connection = await this.findOne(context, connectionId);
    
    if (!connection.accessToken) {
      throw new NotFoundException('Connection not authenticated');
    }

    const provider = connection.provider;
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    // Check if token needs refresh
    if (connection.tokenExpiry && new Date(connection.tokenExpiry) < new Date()) {
      await this.refreshToken(context, connectionId);
      // Reload connection to get new tokens
      const refreshedConnection = await this.findOne(context, connectionId);
      connection.accessToken = refreshedConnection.accessToken;
    }

    // Make generic API request with the access token
    try {
      const response = await fetch(`${provider.apiBaseUrl || 'https://www.googleapis.com'}${endpoint}`, {
        ...options,
        headers: {
          ...options?.headers,
          'Authorization': `Bearer ${connection.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error('API request failed', { connectionId, endpoint, error });
      throw error;
    }
  }

  private async refreshToken(context: RequestContext, connectionId: string): Promise<void> {
    const connection = await this.findOne(context, connectionId);
    
    if (!connection.refreshToken) {
      throw new NotFoundException('No refresh token available');
    }

    const provider = connection.provider;
    if (!provider) {
      throw new NotFoundException('Provider not found');
    }

    const client = new AuthorizationCode({
      client: {
        id: connection.clientid!,
        secret: connection.clientsecret!,
      },
      auth: {
        tokenHost: provider.tokenHost || 'https://oauth2.googleapis.com',
        tokenPath: provider.tokenPath || '/token',
        authorizePath: provider.authorizePath || '/o/oauth2/v2/auth',
      },
    });

    try {
      const accessToken = client.createToken({
        access_token: connection.accessToken!,
        refresh_token: connection.refreshToken,
        expires_at: connection.tokenExpiry,
      });

      const refreshedToken = await accessToken.refresh();

      // Update tokens in database
      await this.connectionRepository.update(
        {
          id: connectionId,
          user: {
            id: context.userId,
          },
        },
        {
          accessToken: refreshedToken.token.access_token,
          refreshToken: refreshedToken.token.refresh_token || connection.refreshToken,
          tokenExpiry: refreshedToken.token.expires_at,
        },
      );
    } catch (error) {
      this.logger.error('Token refresh failed', { connectionId, error });
      throw new NotFoundException('Failed to refresh token');
    }
  }

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////




}
