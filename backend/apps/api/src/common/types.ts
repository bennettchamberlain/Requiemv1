export interface RequestContext {
  traceId?: string;
  userId?: string;
}

/**
 * Symbol representing system-level operations (not associated with a specific user).
 * Use this when performing automated tasks, migrations, or system maintenance.
 */
export const SYSTEM_USER = Symbol('SYSTEM_USER');

export interface ServiceContext {
  userId: string | typeof SYSTEM_USER;
}
