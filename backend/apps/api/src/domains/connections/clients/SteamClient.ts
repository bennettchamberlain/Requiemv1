import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import type { Connection } from '../entities/ConnectionEntity';
import { ProviderKeyService } from '../services/ProviderKeyService';

import { BaseClient } from './BaseClient';
import type { TokenExchange } from './types';

/**
 * Steam uses API key authentication rather than OAuth2.
 * The API key is stored as the accessToken on the connection,
 * and the Steam ID is stored as the externalId.
 */
@Injectable()
export class SteamClient extends BaseClient {
  constructor(
    readonly logger: LoggerService,
    private readonly providerKeyService: ProviderKeyService,
  ) {
    super();
    this.logger.setContext(SteamClient.name);
  }

  protected readonly authorizationEndpoint = 'https://steamcommunity.com/openid/login';

  private readonly baseUrl = 'https://api.steampowered.com';

  async request<T>(connection: Connection, endpoint: string, options?: RequestInit) {
    const apiKey = connection.accessToken;

    if (!apiKey) {
      throw new Error('Steam API key not configured on connection');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;

    // Append key parameter
    const separator = url.includes('?') ? '&' : '?';
    const fullUrl = `${url}${separator}key=${apiKey}`;

    const response = await fetch(fullUrl, {
      ...options,
      headers: {
        ...options?.headers,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Steam API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return (await response.json()) as T;
  }

  async getAuthorizationUrl() {
    const params = new URLSearchParams({
      'openid.return_to': config.auth.openid.callbackUrl,
      'openid.ns': 'http://specs.openid.net/auth/2.0',
      'openid.mode': 'checkid_setup',
      'openid.assoc_type': 'HMAC-SHA1',
      'openid.realm': `https://${config.hostname}`,
      'openid.identity': `http://specs.openid.net/auth/2.0/identifier_select`,
      'openid.claimed_id': `http://specs.openid.net/auth/2.0/identifier_select`,
    });

    return `${this.authorizationEndpoint}?${params.toString()}`;
  }

  async exchangeAuthorizationCode(): Promise<TokenExchange> {
    throw new Error('Steam does not use OAuth2 token exchange');
  }

  async refreshAccessToken(): Promise<TokenExchange> {
    // Steam API keys don't expire
    throw new Error('Steam API keys do not require refresh');
  }

  async getAccountIdentifier(connection: Connection) {
    // The Steam ID is stored as the externalId on the connection
    return connection.externalId || '';
  }

  async getApiKey(connection: Connection) {
    const keyFromEnv = process.env['STEAM_API_KEY'];

    const keys = await this.providerKeyService
      .findByProviderId({ userId: connection.userId }, connection.id)
      .catch(() => null);

    const apiKey = keys ? keys.clientId : keyFromEnv;

    if (!apiKey) {
      throw new Error('Steam API key not configured');
    }

    return apiKey;
  }
}
