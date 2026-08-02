/**
 * Sentry bootstrap. MUST be the first import in `main.ts` — the SDK patches
 * Node internals on init and instrumentation applied after the app modules are
 * loaded misses everything they set up at import time.
 *
 * Reporting is opt-in: with no `SENTRY_DSN` this module initialises nothing and
 * the process makes no outbound connection. See `common/telemetry/settings.ts`
 * for the kill switches.
 */

import './bootstrap';

import * as Sentry from '@sentry/nestjs';

import { resolveTelemetrySettings, scrubEvent } from '@ci/common/telemetry';

export const COMPONENT = 'ci-server-api';

// CI-Server registers its own `uncaughtException`/`unhandledRejection` handlers
// (application.ts) which log, capture, flush and control the exit code. Drop
// Sentry's equivalents so a crash is reported exactly once and our handler —
// not the SDK's — decides when the process dies.
const MANUALLY_HANDLED_INTEGRATIONS = new Set(['OnUncaughtException', 'OnUnhandledRejection']);

export const telemetry = resolveTelemetrySettings(process.env, COMPONENT);

if (telemetry.enabled && telemetry.dsn) {
  Sentry.init({
    dsn: telemetry.dsn,
    environment: telemetry.environment,
    release: telemetry.release,
    enabled: true,
    // Error reporting only. Tracing on an appliance that holds the user's whole
    // timeline would ship request shapes we have no consent to collect.
    tracesSampleRate: 0,
    profilesSampleRate: 0,
    // Never attach IPs, cookies or request bodies. This is deliberate and
    // differs from CI-Hub's current setting — see
    // CI-Engineering/architecture/subsystems/security-trust-and-ops.md gap #7.
    sendDefaultPii: false,
    integrations: (defaults) => defaults.filter((integration) => !MANUALLY_HANDLED_INTEGRATIONS.has(integration.name)),
    beforeSend: scrubEvent,
  });

  Sentry.setTag('component', COMPONENT);

  if (telemetry.deploymentVersion) {
    Sentry.setTag('deployment_version', telemetry.deploymentVersion);
  }
}

/** True when `Sentry.init` actually ran; capture calls are no-ops otherwise. */
export function isTelemetryEnabled(): boolean {
  return telemetry.enabled;
}

/**
 * Flush buffered events, bounded so a wedged network can't hold shutdown open.
 * Resolves even when Sentry was never initialised.
 */
export async function flushTelemetry(timeoutMs = 2000): Promise<void> {
  if (!telemetry.enabled) {
    return;
  }

  try {
    await Sentry.close(timeoutMs);
  } catch {
    // Never let a reporting failure change how the process exits.
  }
}
