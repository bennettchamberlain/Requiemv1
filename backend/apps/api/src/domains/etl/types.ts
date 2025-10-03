import type { Connection } from '../connections/types';
import type { User } from '../user';

export interface ApiLog {
  readonly id: string;
  readonly user_id?: string;
  readonly connection_id?: string;
  readonly scope?: string;
  readonly content?: unknown;
  readonly user?: User;
  readonly connection?: Connection;
  readonly created_at: Date;
  readonly last_processed?: Date;
}
