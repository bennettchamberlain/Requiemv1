/**
 * Server-rendered HTML for the app-connect consent step.
 *
 * This page is shown on ci-memory's own origin (so the session cookie is
 * in-scope) after the user has signed in. It explains what access the app is
 * requesting and lets the user Allow (mint a scoped key and return to CI-Hub)
 * or say Not now (bounce back to the originating app's interstitial).
 *
 * NO client JavaScript. The page is fronted by the CI-Server nginx gateway,
 * which stamps its own `script-src 'self'` CSP on every response; the browser
 * enforces the intersection of that and this route's CSP, so an inline
 * `<script>` — nonce'd or not — can never run here. Both actions are therefore
 * plain HTML: Allow is a same-origin `<form method="POST">` (allowed by
 * `form-action 'self'`) that the server answers with a 302 to CI-Hub; Not now
 * is an `<a>` to the CI-Hub return URL carrying `error=access_denied` (a
 * top-level link navigation, not restricted by `form-action`). This mirrors the
 * agent-app interstitials (CI-OpenClaw / CI-Hermes), which are also pure
 * form/link markup for the same reason.
 *
 * Kept as a typed template module (rather than a separate .html asset) so the
 * markup, the context-specific escaping it depends on, and its only inputs stay
 * co-located and bundle automatically — no runtime template loading / dist-asset
 * copying. The one large static block (styles) lives in the constant below so
 * the page skeleton in `renderConnectConsentPage` reads clearly.
 *
 * NOTE (i18n): CI-Server's API has no i18n runtime, so these strings are
 * English-only. If richer/localised consent UX is needed, this page should move
 * into the CI-Server SPA (which has i18n) with the backend exposing the consent
 * metadata as JSON — tracked as a follow-up.
 */

import { MEMORY_LOGO_DATA_URI } from './connectMemoryLogo';

export interface ConnectConsentParams {
  /** The requesting app's URN (identity, always present). */
  appUrn: string;
  /** Human-friendly app name for display; falls back to the URN. */
  appName?: string;
  /** Opaque CI-Hub state nonce, echoed back on the redirect. */
  state: string;
  /** Allowlisted CI-Hub return URL (validated before rendering). */
  returnUrl: string;
  /** Pre-built CI-Hub URL to send the user to on "Not now" (return + error). */
  denyUrl: string;
  /** CSRF token to echo in the form's hidden field; matches the csrf cookie. */
  csrfToken: string;
  /** Per-request CSP nonce; stamped on the inline <style> so the page's own
   *  styles apply while any injected inline style (no nonce) is blocked. */
  nonce: string;
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
 * Static page styles (no request-derived input). Mirrors the agent-app connect
 * interstitials' aesthetic: navy background, elevated card, teal brand-gradient
 * primary pill, with a light-scheme fallback. The Companion Memory logo sits on
 * a dark rounded tile (it has an opaque background). Buttons stay side-by-side
 * (`.actions{display:flex}`), the layout this consent page has always used.
 */
const CONSENT_STYLES = /* css */ `
    :root{color-scheme:dark;--bg:#041620;--card:#0a222e;--border:#1f4a55;--fg:#f5f8fa;--fg-dim:#9bb2b7;--brand-grad:linear-gradient(135deg,#0b6e74 0%,#079d99 100%);--on-accent:#fff;--shadow:0 6px 24px rgba(4,22,32,.22)}
    @media (prefers-color-scheme:light){:root{color-scheme:light;--bg:#f3f3f3;--card:#f7f7f9;--border:#d3dddf;--fg:#010f16;--fg-dim:#4f6168;--shadow:0 6px 24px rgba(4,22,32,.12)}}
    *{box-sizing:border-box}
    body{font-family:"Montserrat",system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);padding:40px 20px}
    .card{width:100%;max-width:440px;text-align:center;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:36px 28px;box-shadow:var(--shadow)}
    .logo-wrap{display:flex;justify-content:center;margin:0 auto 22px}
    .cm{width:56px;height:56px;object-fit:contain;border-radius:14px;background:#000;box-shadow:0 2px 10px rgba(0,0,0,.28)}
    h1{font-size:20px;font-weight:700;margin:0 0 8px}
    p{line-height:1.5;color:var(--fg-dim);font-size:14px;margin:0 0 24px}
    .app{color:var(--fg);font-weight:600}
    .actions{display:flex;gap:12px}
    .actions form{margin:0;flex:1}
    .btn{display:block;width:100%;padding:12px 20px;border-radius:999px;border:0;font-size:15px;font-weight:600;line-height:1.2;cursor:pointer;text-align:center;text-decoration:none;font-family:inherit}
    .primary{background:var(--brand-grad);color:var(--on-accent)}
    .primary:hover{filter:brightness(1.06)}
    .secondary{flex:1;background:transparent;color:var(--fg-dim);border:1px solid var(--border)}
    .secondary:hover{color:var(--fg);border-color:var(--fg-dim)}`;

/**
 * Render the consent page. The request-derived values (`appName`, `state`,
 * `returnUrl`, `denyUrl`, `csrfToken`) are HTML-escaped for their contexts to
 * prevent injection; `returnUrl`/`denyUrl` have already been origin-allowlisted
 * by the caller.
 */
export function renderConnectConsentPage(params: ConnectConsentParams): string {
  const displayName = escapeHtml(params.appName?.trim() || params.appUrn);
  const appUrn = escapeHtml(params.appUrn);
  const state = escapeHtml(params.state);
  const returnUrl = escapeHtml(params.returnUrl);
  const denyUrl = escapeHtml(params.denyUrl);
  const csrfToken = escapeHtml(params.csrfToken);

  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connect to Companion Memory</title>
  <style nonce="${params.nonce}">${CONSENT_STYLES}</style>
</head>
<body>
  <main class="card">
    <div class="logo-wrap">
      <img class="cm" src="${MEMORY_LOGO_DATA_URI}" alt="Companion Memory" width="56" height="56" />
    </div>
    <h1>Connect to Companion Memory</h1>
    <p><span class="app">${displayName}</span> is requesting access to your Companion Memory,
      so it can remember your context across sessions. It will be able to read and write your
      long-term memory. You can disconnect it at any time.</p>
    <div class="actions">
      <a class="btn secondary" href="${denyUrl}">Not now</a>
      <form method="POST" action="/api/connect/approve">
        <input type="hidden" name="app" value="${appUrn}" />
        <input type="hidden" name="state" value="${state}" />
        <input type="hidden" name="return" value="${returnUrl}" />
        <input type="hidden" name="csrf" value="${csrfToken}" />
        <button class="btn primary" type="submit">Allow</button>
      </form>
    </div>
  </main>
</body>
</html>`;
}

/**
 * Render the page that carries the browser back to CI-Hub after the Allow POST.
 *
 * Why not just `res.redirect(hubUrl)`? The nginx gateway stamps `form-action
 * 'self'` on every response, and Chrome enforces form-action on the *redirect*
 * of a form submission — so a 302 from the Allow form to the cross-origin CI-Hub
 * URL is silently refused (the POST completes, then nothing happens). A
 * `<meta http-equiv="refresh">` is a top-level navigation, NOT a form submission,
 * so form-action does not apply — the same navigation kind the "Not now" <a> link
 * uses, which reaches CI-Hub fine. The <a> is a no-JS manual fallback. The dark
 * background matches the consent page so there's no white flash on the hop.
 *
 * `hubUrl` is an already-origin-allowlisted CI-Hub URL; it is HTML-escaped here
 * for the meta content and href attributes.
 */
export function renderConnectRedirectPage(hubUrl: string): string {
  const url = escapeHtml(hubUrl);

  return /* html */ `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0; url=${url}" />
  <title>Connecting…</title>
  <style>
    :root { color-scheme: dark light; }
    body { font-family: "Montserrat", system-ui, -apple-system, "Segoe UI", sans-serif;
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      background: #041620; color: #9bb2b7; }
    @media (prefers-color-scheme: light) { body { background: #f3f3f3; color: #4f6168; } }
    a { color: inherit; }
  </style>
</head>
<body>
  <p>Connecting to Companion Memory… <a href="${url}">Continue</a></p>
</body>
</html>`;
}

/**
 * Render a minimal error page for connect failures that cannot proceed to the
 * consent step (e.g. a missing or disallowed return URL).
 */
export function renderConnectErrorPage(message: string): string {
  return /* html */ `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Connect error</title>
  <style>body{font-family:system-ui,sans-serif;margin:3rem;color:#333}</style></head>
<body><h1>Unable to connect</h1><p>${escapeHtml(message)}</p></body>
</html>`;
}
