/**
 * `beforeSend` payload scrubber.
 *
 * CI-Server holds the user's entire digital life, so anything on its way to
 * Sentry is treated as hostile until proven otherwise: credentials are
 * redacted, home directories are collapsed to `~` (they leak account names),
 * and oversized strings are truncated so a stray blob can't smuggle memory
 * contents out inside an exception message.
 *
 * Ported from CI-Hub's `sentry-scrubber.ts` (PR #697) so the two appliance
 * halves redact identically.
 */

import type { ErrorEvent } from '@sentry/nestjs';

const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /(?:api[-_ ]?key|token|password|secret|jwt|auth)[\s=:"']+[^\s"',}\]]+/gi,
  /tskey-[A-Za-z0-9-]+/gi,
  // Postgres/Redis/AMQP URLs carry credentials in the authority section.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi,
];

// Windows first: the macOS pattern also matches the `/Users/<name>` inside
// `C:/Users/<name>`, and replacing that leaves a stranded `C:~/…` with the drive
// letter still attached. The longest-prefix forms have to win.
const HOME_PATH_PATTERNS = [
  /[A-Za-z]:\\Users\\[^\\/\s]+/g, // Windows (backslash)
  /[A-Za-z]:\/Users\/[^/\s]+/g, // Windows (forward-slash)
  /\/Users\/[^/\s]+/g, // macOS
  /\/home\/[^/\s]+/g, // Linux
];

// `api[-_ ]?key` (not the literals `apikey|api_key`) so the hyphenated header
// forms match too — `x-api-key` is CI-Server's primary API-key header, and the
// SDK ships request headers even with sendDefaultPii disabled.
const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|cookie|jwt|api[-_ ]?key|dsn|pepper|private[-_]?key|hub[-_]user/i;

// Headers whose value is a URL the user navigated from — same query-string
// exposure as request.url, and not caught by SENSITIVE_KEY_PATTERN.
const URL_VALUED_HEADERS = ['referer', 'referrer', 'location'];

const MAX_STRING_LENGTH = 8000;

/**
 * Strip query and hash from a URL. On this appliance those carry the user's own
 * search terms and entity names (`/api/graph/search?query=…&people=…`).
 */
export function scrubUrl(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

export function scrubString(value: string): string {
  let scrubbed = value;

  for (const pattern of HOME_PATH_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '~');
  }

  for (const pattern of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[Filtered]');
  }

  if (scrubbed.length > MAX_STRING_LENGTH) {
    return `${scrubbed.slice(0, MAX_STRING_LENGTH)}… [truncated]`;
  }

  return scrubbed;
}

function scrubValue(value: unknown, depth = 0): unknown {
  // Guard against cyclic/deep structures — a runaway walk in beforeSend would
  // stall the reporting path on every captured error.
  if (depth > 8) {
    return '[Truncated]';
  }

  if (typeof value === 'string') {
    return scrubString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, depth + 1));
  }

  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};

    for (const [key, nested] of Object.entries(value)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[Filtered]' : scrubValue(nested, depth + 1);
    }

    return result;
  }

  return value;
}

// Matches Sentry's `beforeSend` signature; the `hint` argument is unused, so it
// is omitted rather than named — a narrower function is still assignable.
export function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.message) {
    event.message = scrubString(event.message);
  }

  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (exception.value) {
        exception.value = scrubString(exception.value);
      }

      // Node's stack parser keeps the absolute path in `filename`/`abs_path`,
      // which leaks the account name outside Docker, and `vars` holds captured
      // locals — on this appliance those are memory rows, note bodies, emails.
      for (const frame of exception.stacktrace?.frames ?? []) {
        if (typeof frame.filename === 'string') {
          frame.filename = scrubString(frame.filename);
        }

        if (typeof frame.abs_path === 'string') {
          frame.abs_path = scrubString(frame.abs_path);
        }

        if (frame.vars) {
          frame.vars = scrubValue(frame.vars) as Record<string, unknown>;
        }
      }
    }
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  // The hostname is the same account-identifying data we collapse `/Users/<name>`
  // to `~` to avoid. `includeServerName: false` in instrument.ts stops the SDK
  // setting it; this is the belt-and-braces half.
  delete event.server_name;

  if (event.request) {
    // Query strings and bodies routinely carry search terms over the user's own
    // memories; headers carry the session cookie.
    delete event.request.cookies;
    delete event.request.data;

    if (event.request.query_string) {
      event.request.query_string = '[Filtered]';
    }

    // `request.url` is built from `req.url`, which on a Node server is
    // path+query — so it carries byte-identical content to the query_string we
    // just filtered. Filtering one without the other redacts nothing.
    if (typeof event.request.url === 'string') {
      event.request.url = scrubUrl(event.request.url);
    }

    if (event.request.headers) {
      const headers = scrubValue(event.request.headers) as Record<string, string>;

      for (const [key, value] of Object.entries(headers)) {
        if (URL_VALUED_HEADERS.includes(key.toLowerCase()) && typeof value === 'string') {
          headers[key] = scrubUrl(value);
        }
      }

      event.request.headers = headers;
    }
  }

  if (event.breadcrumbs) {
    for (const breadcrumb of event.breadcrumbs) {
      if (typeof breadcrumb.message === 'string') {
        breadcrumb.message = scrubString(breadcrumb.message);
      }

      if (breadcrumb.data) {
        breadcrumb.data = scrubValue(breadcrumb.data) as Record<string, unknown>;
      }
    }
  }

  return event;
}
