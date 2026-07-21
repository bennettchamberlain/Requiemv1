interface Opts extends RequestInit {
  timeout?: number;
}

/**
 * Error thrown by {@link fetchJson} for non-2xx responses. Carries the HTTP
 * status so callers can branch on it (e.g. useAuth retries a refresh exactly
 * once on 403 — a stale CSRF token — but never on 401, which means the session
 * itself is invalid).
 */
export class FetchJsonError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`Fetch failed: ${status} ${statusText}`);
    this.name = 'FetchJsonError';
    this.status = status;
  }
}

export async function fetchJson<T>(input: RequestInfo, init?: Opts): Promise<T | undefined> {
  const { timeout, ...rest } = init ?? {};

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController;
  if (timeout != null && rest.signal == null) {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeout);
    rest.signal = controller.signal;
  }

  const res = await fetch(input, rest);

  if (timeoutId != null) {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new FetchJsonError(res.status, res.statusText);
  }

  const text = await res.text();

  return text ? (JSON.parse(text) as T) : undefined;
}
