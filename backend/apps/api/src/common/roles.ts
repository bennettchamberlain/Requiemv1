import config from '@ci/configuration';

export type ProcessRole = 'all' | 'web' | 'worker';
export type ServedRole = 'web' | 'worker';

/** Which half of the appliance this process is. See `configuration.ts` `role`. */
export function processRole(): ProcessRole {
  return config.role;
}

/**
 * Whether THIS process serves work assigned to `target`.
 *
 * `all` serves both halves — the single-process topology every test and
 * standalone `yarn dev` runs under, which is why role-gating anything
 * defaults to today's behavior unless a deployment opts into the split.
 * Consulted at module-load time by decorators (config parses synchronously),
 * so a process's role is fixed for its lifetime.
 */
export function serves(target: ServedRole): boolean {
  const role = processRole();

  return role === 'all' || role === target;
}
