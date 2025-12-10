import type { LoggerService } from '@ci/common/logging';

import type { Connection } from '../entities/ConnectionEntity';

import type { SyncResponse, TokenExchange } from './types';

export abstract class BaseClient {
  protected abstract readonly logger: LoggerService;

  abstract getAuthorizationUrl(connection: Connection): Promise<string>;

  abstract exchangeAuthorizationCode(code: string): Promise<TokenExchange>;

  abstract refreshAccessToken(connection: Connection): Promise<TokenExchange>;

  abstract request<T>(connection: Connection, endpoint: string, options?: RequestInit): Promise<T>;

  abstract sync(connection: Connection): Promise<SyncResponse[]>;
}
