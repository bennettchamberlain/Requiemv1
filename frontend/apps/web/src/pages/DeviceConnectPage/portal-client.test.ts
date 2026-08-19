import { afterEach, describe, expect, it, vi } from 'vitest';

import { listMemoryServers, signInToPortal } from './portal-client';

describe('device-connect portal-client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('signs in with email and returns a session token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ token: 'sess-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const auth = await signInToPortal('a@b.com', 'secret', 'https://hub.example.com');

    expect(auth.token).toBe('sess-1');
    expect(auth.kind).toBe('session');
    expect(fetch).toHaveBeenCalledWith(
      'https://hub.example.com/api/auth/sign-in/email',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('lists Memory Servers from slug=ci-memory for an OIDC token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            apps: [{ url: 'https://memory.example.com', deviceName: 'Home', deviceSlug: 'home' }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const devices = await listMemoryServers(
      { token: 'oidc-at', cookie: null, kind: 'oauth' },
      'https://hub.example.com',
    );

    expect(fetch).toHaveBeenCalledWith(
      'https://hub.example.com/api/users/me/apps?slug=ci-memory',
      expect.anything(),
    );
    expect(devices).toEqual([
      { id: 'home', name: 'Home', status: 'active', memoryUrl: 'https://memory.example.com' },
    ]);
  });

  it('filters session-device lists down to a Memory app URL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            devices: [
              {
                id: 'd1',
                displayName: 'Studio',
                status: 'active',
                apps: [
                  { slug: 'hub', url: 'https://hub.example.com' },
                  { slug: 'ci-memory', url: 'https://memory.example.com' },
                ],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const devices = await listMemoryServers(
      { token: 't', cookie: null, kind: 'session' },
      'https://hub.example.com',
    );

    expect(fetch).toHaveBeenCalledWith('https://hub.example.com/api/devices', expect.anything());
    expect(devices[0]?.memoryUrl).toBe('https://memory.example.com');
  });
});
