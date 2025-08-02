import type { Provider } from '@ci/domains/providers';
import { User } from '@ci/domains/user';

export interface ApiLog {
  readonly id: string;
  readonly content: string;
  readonly user?: User;
  readonly connection?: Connection;
  readonly created_at: Date;
}

export interface Connection {
  readonly id: string;
  readonly name: string | null;
  readonly active: boolean;
  readonly clientid: string | null;
  readonly clientkey: string | null;
  readonly clientsecret: string | null;
  readonly schedule: string | null;
  accessToken: string | null;
  readonly refreshToken: string | null;
  readonly tokenExpiry: Date | null;
  readonly provider?: Provider;
}

export interface CreateConnectionDto {
  name: string;
  providerId: string;
  clientid?: string;
  clientkey?: string;
  clientsecret?: string;
  schedule?: string;
}

export interface UpdateConnectionDto {
  name?: string;
  providerId?: string;
  active?: boolean;
  clientid?: string;
  clientkey?: string;
  clientsecret?: string;
  schedule?: string;
}
