import { apiKeyHeaders } from './apiAuth';
import { buildApiUrl } from './apiBase';

interface Opts extends RequestInit {
  timeout?: number;
}

export async function fetchJson<T>(input: RequestInfo, init?: Opts): Promise<T | undefined> {
  const { timeout, ...rest } = init ?? {};

  // On native, attach the API key (`x-api-key`). No-op on web (returns `{}`), so the
  // request is unchanged. Callers pass plain-object headers, so a shallow merge is
  // safe; the caller's own headers take precedence on the (unused) key collision.
  const keyHeaders = apiKeyHeaders();

  if (Object.keys(keyHeaders).length > 0) {
    rest.headers = { ...keyHeaders, ...(rest.headers as Record<string, string> | undefined) };
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController;
  if (timeout != null && rest.signal == null) {
    controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), timeout);
    rest.signal = controller.signal;
  }

  // String paths (e.g. `/api/...`) are resolved against the configured API origin.
  // On web this is a no-op (origin is ''); on native it targets the user's server.
  const resolved = typeof input === 'string' ? buildApiUrl(input) : input;

  const res = await fetch(resolved, rest);

  if (timeoutId != null) {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();

  return text ? (JSON.parse(text) as T) : undefined;
}
