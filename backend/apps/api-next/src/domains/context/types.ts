import type { User } from '../user';

export interface RequestContext {
  requestId: string;
  user?: User;
}
