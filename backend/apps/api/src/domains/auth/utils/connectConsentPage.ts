/**
 * Server-rendered HTML for the app-connect consent step.
 *
 * This page is shown on ci-memory's own origin (so the session cookie is
 * in-scope) after the user has signed in. It explains what access the app is
 * requesting and, on approval, POSTs to `/api/connect/approve` with the CSRF
 * token (read from the JS-readable csrf cookie) and follows the one-time-code
 * redirect the server returns.
 *
 * Kept as a typed template module (rather than a separate .html asset) so the
 * markup, the context-specific escaping it depends on, and its only inputs stay
 * co-located and bundle automatically — no runtime template loading / dist-asset
 * copying. The two large static blocks (styles + client script) live in the
 * constants below so the page skeleton in `renderConnectConsentPage` reads clearly.
 *
 * NOTE (i18n): CI-Server's API has no i18n runtime, so these strings are
 * English-only. If richer/localised consent UX is needed, this page should move
 * into the CI-Server SPA (which has i18n) with the backend exposing the consent
 * metadata as JSON — tracked as a follow-up.
 */

export interface ConnectConsentParams {
  /** The requesting app's URN (identity, always present). */
  appUrn: string;
  /** Human-friendly app name for display; falls back to the URN. */
  appName?: string;
  /** Opaque CI-Hub state nonce, echoed back on the redirect. */
  state: string;
  /** Allowlisted CI-Hub return URL (validated before rendering). */
  returnUrl: string;
  /** Name of the JS-readable CSRF cookie the page must echo as a header. */
  csrfCookieName: string;
}

/** Escape a string for safe interpolation into HTML text/attribute context. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Encode a value for safe embedding inside an inline `<script>` as a JSON
 * literal — JSON.stringify plus `<` escaping to prevent `</script>` breakout.
 */
function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/** Static page styles (no request-derived input). */
const CONSENT_STYLES = `
    :root { color-scheme: light dark; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; display: grid;
      min-height: 100vh; place-items: center; background: #0b1220; color: #e6edf3; }
    .card { max-width: 30rem; margin: 1.5rem; padding: 2rem; border-radius: 1rem;
      background: #111a2e; box-shadow: 0 10px 40px rgba(0,0,0,.35); }
    h1 { font-size: 1.35rem; margin: 0 0 .75rem; }
    p { line-height: 1.5; color: #b6c2d4; }
    .app { color: #e6edf3; font-weight: 600; }
    .actions { display: flex; gap: .75rem; margin-top: 1.5rem; }
    button { flex: 1; padding: .75rem 1rem; border-radius: .6rem; border: 0;
      font-size: 1rem; font-weight: 600; cursor: pointer; }
    .allow { background: #2f9e8f; color: #fff; }
    .deny { background: transparent; color: #b6c2d4; border: 1px solid #33415c; }
    button[disabled] { opacity: .6; cursor: default; }
    .error { color: #f2777a; margin-top: 1rem; min-height: 1.2rem; }`;

/**
 * The client bootstrap script. Its only server-injected value is `bootstrap` —
 * the JSON config object (already `</script>`-safe via {@link jsonForScript}) it
 * assigns to `P`; everything else is static. Handles the allow/deny buttons: deny
 * bounces back to the return URL with `error`, allow POSTs to `/api/connect/approve`
 * (with the CSRF header) and follows the one-time-code redirect.
 */
function consentScript(bootstrap: string): string {
  return `(function () {
      var P = ${bootstrap};

      function readCookie(name) {
        return document.cookie.split('; ').reduce(function (acc, part) {
          var idx = part.indexOf('=');
          if (idx > -1 && part.slice(0, idx) === name) { return decodeURIComponent(part.slice(idx + 1)); }
          return acc;
        }, '');
      }

      function returnWith(paramName, value) {
        try {
          var url = new URL(P.returnUrl);
          url.searchParams.set(paramName, value);
          url.searchParams.set('state', P.state);
          window.location.href = url.toString();
        } catch (e) { /* allowlisted upstream; ignore */ }
      }

      document.getElementById('deny').addEventListener('click', function () {
        returnWith('error', 'access_denied');
      });

      document.getElementById('allow').addEventListener('click', function () {
        var allow = document.getElementById('allow');
        var errEl = document.getElementById('error');
        allow.disabled = true;
        errEl.textContent = '';

        fetch('/api/connect/approve', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': readCookie(P.csrfCookieName),
          },
          body: JSON.stringify({ app: P.appUrn, state: P.state, return: P.returnUrl }),
        })
          .then(function (res) {
            if (!res.ok) { throw new Error('approve_failed_' + res.status); }
            return res.json();
          })
          .then(function (data) {
            if (data && data.redirectUrl) { window.location.href = data.redirectUrl; }
            else { throw new Error('no_redirect'); }
          })
          .catch(function () {
            allow.disabled = false;
            errEl.textContent = 'Something went wrong connecting. Please try again.';
          });
      });
    })();`;
}

/**
 * Render the consent page. The three request-derived values (`appName`,
 * `state`, `returnUrl`) are escaped for their respective contexts to prevent
 * injection; `returnUrl` has already been origin-allowlisted by the caller.
 */
export function renderConnectConsentPage(params: ConnectConsentParams): string {
  const displayName = escapeHtml(params.appName?.trim() || params.appUrn);

  const bootstrap = jsonForScript({
    appUrn: params.appUrn,
    state: params.state,
    returnUrl: params.returnUrl,
    csrfCookieName: params.csrfCookieName,
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect to Companion Memory</title>
  <style>${CONSENT_STYLES}</style>
</head>
<body>
  <main class="card">
    <h1>Connect to Companion Memory</h1>
    <p><span class="app">${displayName}</span> is requesting access to your Companion Memory,
      so it can remember your context across sessions. It will be able to read and write your
      long-term memory. You can disconnect it at any time.</p>
    <div class="actions">
      <button class="deny" id="deny" type="button">Not now</button>
      <button class="allow" id="allow" type="button">Allow</button>
    </div>
    <div class="error" id="error" role="alert"></div>
  </main>
  <script>${consentScript(bootstrap)}</script>
</body>
</html>`;
}

/**
 * Render a minimal error page for connect failures that cannot proceed to the
 * consent step (e.g. a missing or disallowed return URL).
 */
export function renderConnectErrorPage(message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Connect error</title>
  <style>body{font-family:system-ui,sans-serif;margin:3rem;color:#333}</style></head>
<body><h1>Unable to connect</h1><p>${escapeHtml(message)}</p></body>
</html>`;
}
