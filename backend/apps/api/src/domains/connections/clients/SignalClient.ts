import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import type { Connection } from '../entities/ConnectionEntity';

import { BaseClient } from './BaseClient';
import type { TokenExchange } from './types';

@Injectable()
export class SignalClient extends BaseClient {
  constructor(readonly logger: LoggerService) {
    super();
    this.logger.setContext(SignalClient.name);
  }

  get restUrl(): string {
    return config.signalCli.restUrl.replace(/\/$/, '');
  }

  async resolveAccountFromApiKey(apiKey: string): Promise<string> {
    const response = await fetch(`${this.restUrl}/v1/accounts`, {
      headers: this.buildHeaders(apiKey),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Failed to validate Signal API key: ${response.status} ${errorText}`);
    }

    const accounts = (await response.json()) as string[];

    if (!Array.isArray(accounts) || accounts.length === 0) {
      throw new Error('No Signal accounts found for the provided API key');
    }

    return accounts[0];
  }

  getAuthorizationUrl(): Promise<string> {
    return Promise.reject(new Error('Signal uses API key authentication'));
  }

  exchangeAuthorizationCode(): Promise<TokenExchange> {
    return Promise.reject(new Error('Signal uses API key authentication'));
  }

  async refreshAccessToken(connection: Connection): Promise<TokenExchange> {
    return {
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      tokenExpiry: connection.tokenExpiry,
    };
  }

  getAccountIdentifier(connection: Connection): Promise<string> {
    if (connection.externalId) {
      return Promise.resolve(connection.externalId);
    }

    if (!connection.accessToken) {
      return Promise.reject(new Error('Signal connection missing API key'));
    }

    return this.resolveAccountFromApiKey(connection.accessToken);
  }

  async requestRaw(connection: Connection, endpoint: string, options?: RequestInit): Promise<Response> {
    if (!connection.accessToken) {
      throw new Error('Signal connection missing API key');
    }

    const url = endpoint.startsWith('http') ? endpoint : `${this.restUrl}${endpoint}`;

    return fetch(url, {
      ...options,
      headers: {
        ...options?.headers,
        ...this.buildHeaders(connection.accessToken),
      },
    });
  }

  async request<T>(connection: Connection, endpoint: string, options?: RequestInit): Promise<T> {
    const response = await this.requestRaw(connection, endpoint, options);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Signal API request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return (await response.json()) as T;
  }

  private buildHeaders(apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }
}
