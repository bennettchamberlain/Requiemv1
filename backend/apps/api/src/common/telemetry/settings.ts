/**
 * Telemetry (Sentry) settings resolution.
 *
 * Error reporting on the appliance is **opt-in and off by default**: with no
 * `SENTRY_DSN` nothing is initialised and no network call is ever made. Two
 * kill switches disable reporting even when a DSN has been baked into an image
 * (which is how Hub-installed Memory receives one), so an operator can always
 * turn telemetry off without rebuilding:
 *
 *   - `CI_TELEMETRY=off`   — explicit opt-out
 *   - `CI_LOCAL_ONLY=true` — local-only mode must mean zero phone-home, see
 *     CI-Engineering/proposals/local-only-mode.md
 *
 * We never send PII (`sendDefaultPii: false`) and every payload goes through
 * `scrubEvent` before it leaves the process.
 */

export type TelemetryDisabledReason = 'no-dsn' | 'opt-out' | 'local-only';

export interface TelemetrySettings {
  enabled: boolean;
  disabledReason: TelemetryDisabledReason | null;
  dsn: string | null;
  environment: string;
  release: string | undefined;
  component: string;
  deploymentVersion: string | null;
}

const FALSEY = new Set(['off', 'false', '0', 'no', 'disabled']);
const TRUTHY = new Set(['on', 'true', '1', 'yes', 'enabled']);

function read(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();

  return value ? value : null;
}

/** `CI_TELEMETRY=off` (any falsey spelling) opts out; anything else leaves the DSN in charge. */
export function isTelemetryOptedOut(env: NodeJS.ProcessEnv): boolean {
  const value = read(env, 'CI_TELEMETRY')?.toLowerCase();

  return value !== null && value !== undefined && FALSEY.has(value);
}

/** Local-only mode forbids all egress, telemetry included. */
export function isLocalOnly(env: NodeJS.ProcessEnv): boolean {
  const value = read(env, 'CI_LOCAL_ONLY')?.toLowerCase();

  return value !== null && value !== undefined && TRUTHY.has(value);
}

export function resolveTelemetrySettings(env: NodeJS.ProcessEnv, component: string): TelemetrySettings {
  const dsn = read(env, 'SENTRY_DSN');
  const deploymentVersion = read(env, 'CI_SERVER_VERSION');

  const base = {
    dsn,
    component,
    deploymentVersion,
    environment: read(env, 'SENTRY_ENV') ?? read(env, 'CI_SERVER_ENVIRONMENT') ?? read(env, 'NODE_ENV') ?? 'development',
    release: read(env, 'SENTRY_RELEASE') ?? (deploymentVersion ? `${component}@${deploymentVersion}` : undefined),
  };

  // Order matters: report the *operator's* explicit choice ahead of "no DSN" so
  // the startup log tells them why reporting is off.
  if (isLocalOnly(env)) {
    return { ...base, enabled: false, disabledReason: 'local-only' };
  }

  if (isTelemetryOptedOut(env)) {
    return { ...base, enabled: false, disabledReason: 'opt-out' };
  }

  if (!dsn) {
    return { ...base, enabled: false, disabledReason: 'no-dsn' };
  }

  return { ...base, enabled: true, disabledReason: null };
}
