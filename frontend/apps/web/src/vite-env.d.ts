/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Google Maps JS API key (must have Billing + the Directions API enabled).
   * Optional — when unset, the memory map's route layer is disabled and no
   * Google Maps requests are made.
   */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;

  /**
   * Sentry DSN for browser error reporting. Optional — when unset no Sentry
   * code initialises and the bundle makes no request to Sentry. See
   * `src/lib/telemetry.ts` and docs/operations/error-reporting.md.
   */
  readonly VITE_SENTRY_DSN?: string;

  /** Release identifier reported alongside errors, e.g. `ci-server-web@2026.8.1`. */
  readonly VITE_SENTRY_RELEASE?: string;

  /** Environment label for Sentry (falls back to Vite's `MODE`). */
  readonly VITE_CI_SERVER_ENVIRONMENT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
