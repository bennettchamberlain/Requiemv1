import { afterEach, describe, expect, it, vi } from 'vitest';

// fetchJson lives in @ci/common, which has no test runner of its own; the web
// app's node project is the nearest place its units can run.
import { FetchJsonError, fetchJson } from '@ci/common/src/utils/fetchJson';

function jsonResponse(status: number, statusText: string, body: unknown) {
  return new Response(JSON.stringify(body), { status, statusText });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchJson error responses', () => {
  it('surfaces the server message and field issues from a validation 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, 'Bad Request', {
          message: 'Validation failed',
          errors: [{ path: ['password'], message: 'Password must be at least 6 characters' }],
        }),
      ),
    );

    const err = await fetchJson('/api/signup', { method: 'POST' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(FetchJsonError);
    expect((err as FetchJsonError).status).toBe(400);
    expect((err as FetchJsonError).message).toBe('Validation failed');
    expect((err as FetchJsonError).issues).toEqual([
      { path: ['password'], message: 'Password must be at least 6 characters' },
    ]);
  });

  it('surfaces a plain NestJS exception message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(400, 'Bad Request', {
          statusCode: 400,
          message: 'Email already in use',
          error: 'Bad Request',
        }),
      ),
    );

    const err = await fetchJson('/api/signup', { method: 'POST' }).catch((e: unknown) => e);

    expect((err as FetchJsonError).message).toBe('Email already in use');
    expect((err as FetchJsonError).issues).toEqual([]);
  });

  it('falls back to the status line when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('<html>upstream error</html>', { status: 502, statusText: 'Bad Gateway' }),
        ),
    );

    const err = await fetchJson('/api/signup').catch((e: unknown) => e);

    expect((err as FetchJsonError).message).toBe('Fetch failed: 502 Bad Gateway');
    expect((err as FetchJsonError).issues).toEqual([]);
  });

  it('returns parsed JSON for 2xx responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, 'OK', { accessToken: 'token' })));

    await expect(fetchJson('/api/signup')).resolves.toEqual({ accessToken: 'token' });
  });
});
