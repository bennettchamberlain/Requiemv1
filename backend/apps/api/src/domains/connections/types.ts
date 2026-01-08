import { z } from 'zod';

export interface CompleteConnectionDto {
  state: string;
  code: string;
}

export interface CreateConnectionDto {
  name: string;
  providerId: string;
  clientid?: string;
  clientkey?: string;
  clientsecret?: string;
  schedule?: string;
  scopes?: string[];
}

export interface UpdateConnectionDto {
  name?: string;
  active?: boolean;
  schedule?: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiry?: Date | null;
  syncState?: Record<string, unknown> | null;
  scopes?: string[];
}

export interface connectProviderDto {
  scopes: string[];
}

export const connectProviderSchema = z.object({
  scopes: z.array(z.string()),
});
