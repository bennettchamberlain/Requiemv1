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
  /(?:api[_-]?key|token|password|secret|jwt|auth)[\s=:"']+[^\s"',}\]]+/gi,
  /tskey-[A-Za-z0-9-]+/gi,
  // Postgres/Redis/AMQP URLs carry credentials in the authority section.
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi,
];

const HOME_PATH_PATTERNS = [
  /\/Users\/[^/\s]+/g, // macOS
  /\/home\/[^/\s]+/g, // Linux
  /[A-Za-z]:\\Users\\[^\\/\s]+/g, // Windows (backslash)
  /[A-Za-z]:\/Users\/[^/\s]+/g, // Windows (forward-slash)
];

const SENSITIVE_KEY_PATTERN =
  /password|secret|token|authorization|cookie|jwt|apikey|api_key|dsn|pepper|private[_-]?key/i;

const MAX_STRING_LENGTH = 8000;

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
    }
  }

  if (event.extra) {
    event.extra = scrubValue(event.extra) as Record<string, unknown>;
  }

  if (event.request) {
    // Query strings and bodies routinely carry search terms over the user's own
    // memories; headers carry the session cookie.
    delete event.request.cookies;
    delete event.request.data;

    if (event.request.query_string) {
      event.request.query_string = '[Filtered]';
    }

    if (event.request.headers) {
      event.request.headers = scrubValue(event.request.headers) as Record<string, string>;
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
