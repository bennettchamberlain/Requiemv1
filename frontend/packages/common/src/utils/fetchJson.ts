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

// A stalled error body must not hang callers: the request timeout (if any) was
// already cleared when headers arrived, and before body parsing existed the
// error path threw at headers without reading the body — so the read gets its
// own hard bound.
const ERROR_BODY_TIMEOUT_MS = 3_000;

// Normalize a wire entry to the declared shape: only plain objects count, and
// path/message are kept only when their runtime types match.
function toIssue(entry: unknown): FetchJsonIssue[] {
  if (typeof entry !== 'object' || entry == null || Array.isArray(entry)) {
    return [];
  }

  const { path, message } = entry as { path?: unknown; message?: unknown };

  return [
    {
      path: Array.isArray(path)
        ? path.filter(
            (segment): segment is string | number =>
              typeof segment === 'string' || typeof segment === 'number',
          )
        : undefined,
      message: typeof message === 'string' ? message : undefined,
    },
  ];
}

async function parseErrorBody(res: Response): Promise<{ serverMessage?: string; issues: FetchJsonIssue[] }> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const bodyPromise: Promise<unknown> = res.json();
    // If the timer wins the race, a late body rejection must not become an
    // unhandled promise rejection.
    bodyPromise.catch(() => undefined);

    const body = await Promise.race([
      bodyPromise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), ERROR_BODY_TIMEOUT_MS);
      }),
    ]);

    if (typeof body !== 'object' || body == null) {
      return { issues: [] };
    }

    const { message, errors, error } = body as { message?: unknown; errors?: unknown; error?: unknown };

    return {
      // NestJS sends `message` as a string (or string[] from some built-in
      // pipes); object payloads thrown with only an `error` key fall back to it.
      serverMessage:
        typeof message === 'string'
          ? message
          : Array.isArray(message)
            ? message.join('; ')
            : typeof error === 'string'
              ? error
              : undefined,
      issues: Array.isArray(errors) ? errors.flatMap(toIssue) : [],
    };
  } catch (err) {
    // A caller-supplied signal aborting mid-read is a cancellation, not a
    // server failure — let it propagate as such. (Name check rather than
    // instanceof: DOMException does not extend Error in every runtime.)
    if (err != null && typeof err === 'object' && (err as Error).name === 'AbortError') {
      throw err;
    }

    // Body wasn't JSON (e.g. a proxy error page) — fall back to the status line
    return { issues: [] };
  } finally {
    if (timer != null) {
      clearTimeout(timer);
    }
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
