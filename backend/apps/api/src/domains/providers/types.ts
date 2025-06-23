export interface Provider {
  readonly id: string;
  readonly name: string | null;
}

export interface CreateProviderDto {
  name: string;
}

export interface UpdateProviderDto {
  name?: string;
}
