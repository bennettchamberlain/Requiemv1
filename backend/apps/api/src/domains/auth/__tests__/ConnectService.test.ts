const connect = { hubOrigins: 'https://hub.example.com' };

jest.mock('@ci/configuration', () => {
  const actual = jest.requireActual('@ci/configuration').default;

  return {
    __esModule: true,
    default: {
      ...actual,
      auth: {
        ...actual.auth,
        get connect() {
          return connect;
        },
      },
    },
  };
});

import { CONNECT_KEY_SCOPE, ConnectService } from '../services/ConnectService';

/**
 * Unit tests for ConnectService — the connect-flow orchestration and its
 * security-relevant invariants (session resolution, return-origin allowlisting,
 * scoped/expiring key minting, and app-scoped revoke).
 */
function makeDeps() {
  const authService = { validateSessionToken: jest.fn() };
  const userService = { findById: jest.fn() };
  const apiKeyService = { createOrRotate: jest.fn(), findByName: jest.fn(), removeByName: jest.fn() };
  const connectCodeService = { issue: jest.fn() };
  const logger = { setContext: jest.fn(), debug: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() };

  const service = new ConnectService(
    authService as never,
    userService as never,
    apiKeyService as never,
    connectCodeService as never,
    logger as never,
  );

  return { service, authService, userService, apiKeyService, connectCodeService };
}

describe('ConnectService.resolveSessionUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null when no session cookie is present', async () => {
    const { service } = makeDeps();
    expect(await service.resolveSessionUser(undefined)).toBeNull();
  });

  it('resolves the user when the session token is valid and the user exists', async () => {
    const { service, authService, userService } = makeDeps();
    authService.validateSessionToken.mockReturnValue({ sub: 'user-1' });
    userService.findById.mockResolvedValue({ id: 'user-1' });

    expect(await service.resolveSessionUser('tok')).toEqual({ userId: 'user-1' });
  });

  it('returns null when the session token fails verification', async () => {
    const { service, authService } = makeDeps();
    authService.validateSessionToken.mockImplementation(() => {
      throw new Error('bad token');
    });

    expect(await service.resolveSessionUser('tok')).toBeNull();
  });

  it('returns null when the token is valid but the user no longer exists', async () => {
    const { service, authService, userService } = makeDeps();
    authService.validateSessionToken.mockReturnValue({ sub: 'ghost' });
    userService.findById.mockResolvedValue(null);

    expect(await service.resolveSessionUser('tok')).toBeNull();
  });
});

describe('ConnectService.isReturnUrlAllowed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    connect.hubOrigins = 'https://hub.example.com';
  });

  it('allows a URL whose origin is on the allowlist', () => {
    const { service } = makeDeps();
    expect(service.isReturnUrlAllowed('https://hub.example.com/apps/x/callback?a=1')).toBe(true);
  });

  it('rejects a URL on a different origin', () => {
    const { service } = makeDeps();
    expect(service.isReturnUrlAllowed('https://evil.example.com/callback')).toBe(false);
  });

  it('rejects a malformed URL', () => {
    const { service } = makeDeps();
    expect(service.isReturnUrlAllowed('not a url')).toBe(false);
  });

  it('rejects everything when no origins are configured', () => {
    connect.hubOrigins = '';
    const { service } = makeDeps();
    expect(service.isReturnUrlAllowed('https://hub.example.com/x')).toBe(false);
  });

  it('supports multiple comma-separated origins', () => {
    connect.hubOrigins = 'https://a.example.com, https://b.example.com';
    const { service } = makeDeps();
    expect(service.isReturnUrlAllowed('https://b.example.com/x')).toBe(true);
  });
});

describe('ConnectService.approve', () => {
  beforeEach(() => jest.clearAllMocks());

  it('mints a memory-scoped, ~90d-expiring key named app:<urn> and issues a code', async () => {
    const { service, apiKeyService, connectCodeService } = makeDeps();
    apiKeyService.createOrRotate.mockResolvedValue({ key: 'raw-key' });
    connectCodeService.issue.mockResolvedValue('one-time-code');

    const result = await service.approve('user-1', 'urn:app:x');

    const [ctx, data] = apiKeyService.createOrRotate.mock.calls[0];
    expect(ctx).toEqual({ userId: 'user-1' });
    expect(data.name).toBe('app:urn:app:x');
    expect(data.scopes).toEqual([CONNECT_KEY_SCOPE]);
    const ttlDays = (new Date(data.expires_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(ttlDays).toBeGreaterThan(89);
    expect(ttlDays).toBeLessThan(91);

    expect(connectCodeService.issue).toHaveBeenCalledWith('user-1', 'urn:app:x', 'raw-key');
    expect(result).toEqual({ code: 'one-time-code' });
  });
});

describe('ConnectService.buildReturnUrl', () => {
  it('carries the one-time code and state back to the Hub', () => {
    const { service } = makeDeps();
    const url = new URL(service.buildReturnUrl('https://hub.example.com/cb', 'the-code', 'the-state'));

    expect(url.searchParams.get('code')).toBe('the-code');
    expect(url.searchParams.get('state')).toBe('the-state');
  });
});

describe('ConnectService.revokeByApp', () => {
  beforeEach(() => jest.clearAllMocks());

  it('revokes by the stable app:<urn> key name and returns the count', async () => {
    const { service, apiKeyService } = makeDeps();
    apiKeyService.removeByName.mockResolvedValue(1);

    const removed = await service.revokeByApp('urn:app:x');

    expect(apiKeyService.removeByName).toHaveBeenCalledWith('app:urn:app:x');
    expect(removed).toBe(1);
  });
});
