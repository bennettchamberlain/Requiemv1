const CALLBACK_PATH = '/api/authenticate/oidc/callback';

export interface OidcCallbackRequestOrigin {
  /** `x-forwarded-proto` header value, if present (set by Traefik/Cloudflare). */
  forwardedProto?: string | string[];
  /** `x-forwarded-host` header value, if present. */
  forwardedHost?: string | string[];
  /** `Host` header value. */
  host?: string;
  /** Whether the inbound connection itself is TLS (`req.secure`). */
  secure: boolean;
}

/**
 * Normalize a forwarded header to its first hop. These headers can arrive as an
 * array (multiple proxies set the same header) or a comma-separated list
 * (`https, http`); the left-most value is the one the original client connected
 * with. Using the raw value would otherwise yield an invalid `https,http://...`
 * proto or a multi-host authority.
 */
function firstForwardedValue(value?: string | string[]): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;

  return raw?.split(',')[0]?.trim() || undefined;
}

/**
 * Build the OIDC `redirect_uri` (callback) for the "Sign in with CI-Portal" flow.
 *
 * Prefers `publicBaseUrl` — the app's stable public origin injected by CI-Hub as
 * `APP_BASE_URL` (e.g. `https://ci-memory-<org>.companionintelligence.com`).
 *
 * Without it the callback is derived from whatever host the browser used to reach
 * the app. Reaching it at the local `*.localhost` route then produces a
 * `http://...localhost/...` callback that CI-Portal cannot redirect a remote
 * browser back to — which is why Portal login fails when the app is opened on its
 * local route. The request-derived form is kept as a fallback for local/dev
 * installs that have no public base URL.
 */
export function resolveOidcCallbackUrl(origin: OidcCallbackRequestOrigin, publicBaseUrl?: string): string {
  const normalizedBase = publicBaseUrl?.trim().replace(/\/+$/, '');

  if (normalizedBase) {
    return `${normalizedBase}${CALLBACK_PATH}`;
  }

  const proto = firstForwardedValue(origin.forwardedProto) || (origin.secure ? 'https' : 'http');
  const host = firstForwardedValue(origin.forwardedHost) || origin.host?.trim() || 'localhost';

  return `${proto}://${host}${CALLBACK_PATH}`;
}
