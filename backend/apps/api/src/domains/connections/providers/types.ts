import type { Connection } from '../types';

export interface SyncResult {
  api: string;
  data: unknown;
  error?: string;
}

export interface SyncResponse {
  success: boolean;
  message: string;
  data?: {
    results: SyncResult[];
    errors: string[];
  };
}

export interface ApiProvider {
  sync(connection: Connection): Promise<SyncResponse>;
  makeApiRequest(connection: Connection, endpoint: string, options?: RequestInit): Promise<unknown>;
}
