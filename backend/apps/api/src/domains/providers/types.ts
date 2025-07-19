export interface Provider {
  readonly id: string;
  readonly name: string | null;
  readonly tokenHost: string | null;
  readonly tokenPath: string | null;
  readonly authorizePath: string | null;
  readonly apiBaseUrl: string | null;
  readonly scopes: string | null;
}

export interface CreateProviderDto {
  name: string;
  tokenHost?: string;
  tokenPath?: string;
  authorizePath?: string;
  apiBaseUrl?: string;
  scopes?: string;
}

export interface UpdateProviderDto {
  name?: string;
  tokenHost?: string;
  tokenPath?: string;
  authorizePath?: string;
  apiBaseUrl?: string;
  scopes?: string;
}
