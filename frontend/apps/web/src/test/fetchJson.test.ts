import { setApiKey } from '@ci/common/src/utils/apiAuth';
import { setApiBaseUrl } from '@ci/common/src/utils/apiBase';
import { fetchJson } from '@ci/common/src/utils/fetchJson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubFetch(body: unknown = {}) {
  const fetchMock = vi.fn(
    async (): Promise<Response> =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(body),
      }) as unknown as Response,
  );

  vi.stubGlobal('fetch', fetchMock);

  return fetchMock;
}

// The mock's recorded args are untyped; read (input, init) via a cast.
function callArgs(mock: ReturnType<typeof stubFetch>, index = 0): [RequestInfo, RequestInit | undefined] {
  return mock.mock.calls[index] as unknown as [RequestInfo, RequestInit | undefined];
}

describe('fetchJson — base URL resolution', () => {
  beforeEach(() => {
    setApiBaseUrl('');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setApiBaseUrl('');
  });

  it('keeps relative paths same-origin when no base is configured', async () => {
    const fetchMock = stubFetch();

    await fetchJson('/api/x');

    expect(fetchMock).toHaveBeenCalledWith('/api/x', expect.any(Object));
  });

  it('resolves relative paths against the configured origin', async () => {
    setApiBaseUrl('https://ci.example.com');
    const fetchMock = stubFetch();

    await fetchJson('/api/x');

    expect(fetchMock).toHaveBeenCalledWith('https://ci.example.com/api/x', expect.any(Object));
  });

  it('passes a non-string RequestInfo through untouched', async () => {
    setApiBaseUrl('https://ci.example.com');
    const fetchMock = stubFetch();
    const request = { url: 'preconstructed' } as unknown as Request;

    await fetchJson(request);

    expect(fetchMock).toHaveBeenCalledWith(request, expect.any(Object));
  });

  it('parses and returns the JSON body', async () => {
    stubFetch({ hello: 'world' });

    const data = await fetchJson<{ hello: string }>('/api/x');

    expect(data).toEqual({ hello: 'world' });
  });
});

describe('fetchJson — native API key injection', () => {
  beforeEach(() => {
    setApiBaseUrl('');
    setApiKey(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setApiBaseUrl('');
    setApiKey(null);
  });

  it('adds no x-api-key header when no key is set (web)', async () => {
    const fetchMock = stubFetch();

    await fetchJson('/api/x', { headers: { 'Content-Type': 'application/json' } });

    expect(callArgs(fetchMock)[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('injects x-api-key into request headers when a key is set (native)', async () => {
    setApiKey('key-123');
    const fetchMock = stubFetch();

    await fetchJson('/api/x', { headers: { 'Content-Type': 'application/json' } });

    expect(callArgs(fetchMock)[1]?.headers).toEqual({
      'x-api-key': 'key-123',
      'Content-Type': 'application/json',
    });
  });
});
