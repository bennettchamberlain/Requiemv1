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
  endpoints?: string[];
}

export interface UpdateConnectionDto {
  name?: string;
  active?: boolean;
  schedule?: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiry?: Date | null;
  syncState?: Record<string, unknown> | null;
  endpoints?: string[];
}

export interface connectProviderDto {
  endpoints: string[];
}

export const connectProviderSchema = z.object({
  endpoints: z.array(z.string()),
});
