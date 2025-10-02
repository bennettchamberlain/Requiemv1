export interface Connection {
  readonly id: string;
  readonly name: string | null;
  readonly active: boolean;
  readonly schedule: string | null;
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly tokenExpiry: Date | null;
  readonly syncState: Record<string, unknown> | null;
  readonly provider?: Provider;
}

export interface Provider {
  readonly id: string;
  readonly name: string | null;
}

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
}

export interface UpdateConnectionDto {
  name?: string;
  active?: boolean;
  clientid?: string;
  clientkey?: string;
  clientsecret?: string;
  schedule?: string;
}

export interface UpdateConnectionCredentialsDto {
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiry?: Date | null;
}
