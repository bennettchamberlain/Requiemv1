import { Controller, Get, HttpCode } from '@nestjs/common';

import { resolveTelemetrySettings } from '@ci/common/telemetry';

/**
 * Runtime error-reporting consent for the web UI.
 *
 * A DSN baked into the bundle at build time cannot be turned off afterwards,
 * so the `CI_TELEMETRY` / `CI_LOCAL_ONLY` kill switches — including the
 * marketplace "Share crash reports" toggle, which sets `CI_TELEMETRY` on the
 * container — would silently not apply to the browser. This endpoint lets the
 * frontend ask the appliance whether reporting is permitted before it
 * initialises, for the same reason MapsConfigController exists.
 *
 * Deliberately unauthenticated: the browser must consult it before login, since
 * errors happen on the login page too. It exposes no secret — a Sentry DSN is a
 * public client credential, and when reporting is off there is nothing to
 * expose at all.
 */
@Controller('config')
export class TelemetryConfigController {
  @Get('telemetry')
  @HttpCode(200)
  telemetry() {
    // The browser reports as its own component, so resolve against the web
    // component name rather than the API's.
    const settings = resolveTelemetrySettings(process.env, 'ci-server-web');

    if (!settings.enabled) {
      return { enabled: false as const, reason: settings.disabledReason };
    }

    return {
      enabled: true as const,
      environment: settings.environment,
      release: settings.release,
    };
  }
}
