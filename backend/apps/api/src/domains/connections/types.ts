import type { Provider } from '@ci/domains/providers';

export interface Connection {
  readonly id: string;
  readonly name: string | null;
  readonly active: boolean;
  readonly provider?: Provider;
}

export interface CreateConnectionDto {
  name: string;
  providerId: string;
}

export interface UpdateConnectionDto {
  name?: string;
  active?: boolean;
}
