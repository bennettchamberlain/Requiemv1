jest.mock('@ci/configuration', () => {
  const actual = jest.requireActual('@ci/configuration').default;

  return {
    __esModule: true,
    default: {
      ...actual,
      auth: {
        ...actual.auth,
        portal: {
          enabled: true,
          issuer: 'https://hub.test',
          jwksUri: 'https://hub.test/api/auth/jwks',
          audience: 'ci-server,ci-import-tools,ci-even',
        },
      },
    },
  };
});

jest.mock('jose', () => ({
  __esModule: true,
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn(),
}));

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { createRemoteJWKSet, jwtVerify } from 'jose';

import { PortalTokenService } from '../services/PortalTokenService';

const mockJwtVerify = jwtVerify as unknown as jest.Mock;
const mockCreateRemoteJWKSet = createRemoteJWKSet as unknown as jest.Mock;

describe('PortalTokenService', () => {
  let userService: { findByEmail: jest.Mock; create: jest.Mock };
  let logger: { setContext: jest.Mock; debug: jest.Mock };
  let service: PortalTokenService;

  beforeEach(() => {
    mockJwtVerify.mockReset();
    mockCreateRemoteJWKSet.mockReset();
    mockCreateRemoteJWKSet.mockReturnValue('JWKS');
    userService = { findByEmail: jest.fn(), create: jest.fn() };
    logger = { setContext: jest.fn(), debug: jest.fn() };
    service = new PortalTokenService(userService as never, logger as never);
  });

  it('verifies against the portal JWKS with the configured issuer + audience', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: 's1', email: 'liam@ci.computer' } });
    userService.findByEmail.mockResolvedValue({ id: 'u1' });

    await service.verifyAndProvision('the-token');

    expect(mockJwtVerify).toHaveBeenCalledWith('the-token', 'JWKS', {
      issuer: 'https://hub.test',
      // PORTAL_OIDC_AUDIENCE is a comma-separated list, split to an array so jose
      // accepts a token whose aud matches any first-party client.
      audience: ['ci-server', 'ci-import-tools', 'ci-even'],
    });
  });

  it('JIT-provisions a new user from the token claims', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: 's1', email: 'liam@ci.computer', name: 'Liam' } });
    userService.findByEmail.mockResolvedValue(null);
    userService.create.mockResolvedValue({ id: 'u-new' });

    const user = await service.verifyAndProvision('t');

    expect(user).toEqual({ id: 'u-new' });
    expect(userService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'liam@ci.computer', name: 'Liam' }),
    );
  });

  it('returns the existing user without creating a duplicate', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: 's1', email: 'liam@ci.computer' } });
    userService.findByEmail.mockResolvedValue({ id: 'u-existing' });

    expect(await service.verifyAndProvision('t')).toEqual({ id: 'u-existing' });
    expect(userService.create).not.toHaveBeenCalled();
  });

  it('falls back to a deterministic shadow email when the token has no email', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: 'sub-xyz' } });
    userService.findByEmail.mockResolvedValue(null);
    userService.create.mockResolvedValue({ id: 'u2' });

    await service.verifyAndProvision('t');

    expect(userService.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ email: 'oidc-sub-xyz@portal.local' }),
    );
  });

  it('returns null for an invalid token (bad signature / issuer / audience / expiry)', async () => {
    mockJwtVerify.mockRejectedValue(new Error('signature verification failed'));

    expect(await service.verifyAndProvision('bad')).toBeNull();
    expect(userService.create).not.toHaveBeenCalled();
  });

  // A rejected token used to be indistinguishable from no token at all: the
  // catch returned a bare null, so a misconfigured audience or issuer surfaced
  // only as a blanket 401 with nothing to go on. The reason is now logged —
  // without the token itself.
  it('logs why a token was rejected instead of failing silently', async () => {
    const err = Object.assign(new Error('unexpected "aud" claim value'), {
      code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
    });
    mockJwtVerify.mockRejectedValue(err);

    expect(await service.verifyAndProvision('bad-token')).toBeNull();

    expect(logger.debug).toHaveBeenCalledWith(
      'Portal token rejected',
      expect.objectContaining({
        code: 'ERR_JWT_CLAIM_VALIDATION_FAILED',
        reason: 'unexpected "aud" claim value',
      }),
    );
    // The token itself must never reach the logs.
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('bad-token');
  });
});

// The suite above mocks `config`, so it cannot catch an audience missing from
// the config we actually ship. A first-party client absent from this list gets
// a correctly-signed token rejected by jwtVerify — now logged, but still a 401.
// Assert the real default instead.
//
// Keep in step with CI-Portal's PUBLIC_CLIENTS (createAuth.ts): the portal
// issues per-client tokens with `aud === client_id`, so any client registered
// there must be accepted here or it can authenticate but not write to memory.
describe('shipped PORTAL_OIDC_AUDIENCE default', () => {
  it('accepts every first-party client that CI-Portal can issue tokens for', () => {
    // Read rather than import: the api workspace's tsconfig has no
    // resolveJsonModule, so a JSON import passes jest (swc) but fails typecheck.
    const raw = readFileSync(resolvePath(__dirname, '../../../../config/default.json'), 'utf8');
    const defaults = JSON.parse(raw) as { auth: { portal: { audience: string } } };
    const audiences = defaults.auth.portal.audience.split(',').map((a) => a.trim());

    expect(audiences).toContain('ci-server');
    expect(audiences).toContain('ci-hub');
    expect(audiences).toContain('ci-import-tools');
    expect(audiences).toContain('ci-browser-extension');
    expect(audiences).toContain('ci-even');
    // Companion Memory App (CI-Applet), the desktop capture client.
    expect(audiences).toContain('ci-applet');

    expect(new Set(audiences).size).toBe(audiences.length);
    expect(audiences.every((a) => a.length > 0)).toBe(true);
  });
});
