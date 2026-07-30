interface Opts extends RequestInit {
  timeout?: number;
}

/**
 * Field-level validation issue reported by the API. Mirrors the zod issue
 * shape the backend ValidationPipe puts in the `errors` array of 400 bodies,
 * so forms can attach server-side messages to the offending field.
 */
export interface FetchJsonIssue {
  path?: Array<string | number>;
  message?: string;
}

/**
 * Error thrown by {@link fetchJson} for non-2xx responses. Carries the HTTP
 * status so callers can branch on it (e.g. useAuth retries a refresh exactly
 * once on 403 — a stale CSRF token — but never on 401, which means the session
 * itself is invalid). When the response body is JSON, `message` is the
 * server's message and `issues` holds any field-level validation errors, so
 * the backend stays the single source of truth for validation rules.
 */
export class FetchJsonError extends Error {
  readonly status: number;

  readonly issues: FetchJsonIssue[];

  constructor(status: number, statusText: string, serverMessage?: string, issues: FetchJsonIssue[] = []) {
    super(serverMessage || `Fetch failed: ${status} ${statusText}`);
    this.name = 'FetchJsonError';
    this.status = status;
    this.issues = issues;
  }
}

async function parseErrorBody(res: Response): Promise<{ serverMessage?: string; issues: FetchJsonIssue[] }> {
  try {
    const body: unknown = JSON.parse(await res.text());

    if (typeof body !== 'object' || body == null) {
      return { issues: [] };
    }

    const { message, errors } = body as { message?: unknown; errors?: unknown };

    return {
      // NestJS sends `message` as a string, or a string[] for some built-in pipes
      serverMessage:
        typeof message === 'string' ? message : Array.isArray(message) ? message.join('; ') : undefined,
      issues: Array.isArray(errors) ? (errors as FetchJsonIssue[]) : [],
    };
  } catch {
    // Body wasn't JSON (e.g. a proxy error page) — fall back to the status line
    return { issues: [] };
  }
}

export async function fetchJson<T>(input: RequestInfo, init?: Opts): Promise<T | undefined> {
  const { timeout, ...rest } = init ?? {};

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  if (timeout != null && rest.signal == null) {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeout);
    rest.signal = controller.signal;
  }

  // clear in `finally`: if fetch() rejects (network error, DNS failure) before
  // the timeout fires, skipping the clear would leave the timer pending — it
  // would later abort an already-settled request and keep the event loop alive.
  let res: Response;
  try {
    res = await fetch(input, rest);
  } finally {
    if (timeoutId != null) {
      clearTimeout(timeoutId);
    }
  }

  if (!res.ok) {
    const { serverMessage, issues } = await parseErrorBody(res);
    throw new FetchJsonError(res.status, res.statusText, serverMessage, issues);
  }

  const text = await res.text();

  return text ? (JSON.parse(text) as T) : undefined;
}
