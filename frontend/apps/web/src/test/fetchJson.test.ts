import { setApiBaseUrl } from '@ci/common/src/utils/apiBase';
import { fetchJson } from '@ci/common/src/utils/fetchJson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubFetch(body: unknown = {}) {
  const fetchMock = vi.fn(
    async () =>
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
