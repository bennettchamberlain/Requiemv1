import { LoggerService } from '@ci/common/services';

import type { Connection } from '../types';
import type { ApiProvider, SyncResult, SyncResponse } from './types';

export abstract class BaseApiProvider implements ApiProvider {
  protected logger: LoggerService;

  constructor(protected readonly providerName: string) {
    this.logger = new LoggerService(`${providerName}ApiProvider`);
  }

  abstract sync(connection: Connection): Promise<SyncResponse>;

  async makeApiRequest(connection: Connection, endpoint: string, options?: RequestInit): Promise<unknown> {
    if (!connection.accessToken) {
      throw new Error('Connection not authenticated');
    }

    const provider = connection.provider;
    if (!provider || !provider.apiBaseUrl) {
      throw new Error('Provider configuration missing');
    }

    try {
      const response = await fetch(`${provider.apiBaseUrl}${endpoint}`, {
        ...options,
        headers: {
          ...options?.headers,
          Authorization: `Bearer ${connection.accessToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error('API request failed', {
        connectionId: connection.id,
        endpoint,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  protected createSyncResponse(results: SyncResult[], errors: string[]): SyncResponse {
    return {
      success: true,
      message: `Sync completed. ${results.length} APIs processed successfully. ${errors.length} errors occurred.`,
      data: {
        results,
        errors,
      },
    };
  }
}
