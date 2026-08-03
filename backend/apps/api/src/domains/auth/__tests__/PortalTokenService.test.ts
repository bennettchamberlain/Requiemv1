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

import { createRemoteJWKSet, jwtVerify } from 'jose';

import { PortalTokenService } from '../services/PortalTokenService';

const mockJwtVerify = jwtVerify as unknown as jest.Mock;
const mockCreateRemoteJWKSet = createRemoteJWKSet as unknown as jest.Mock;

describe('PortalTokenService', () => {
  let userService: { findByEmail: jest.Mock; create: jest.Mock; findById: jest.Mock };
  let federatedIdentityService: { findUserId: jest.Mock; bind: jest.Mock };
  let service: PortalTokenService;

  beforeEach(() => {
    mockJwtVerify.mockReset();
    mockCreateRemoteJWKSet.mockReset();
    mockCreateRemoteJWKSet.mockReturnValue('JWKS');
    userService = { findByEmail: jest.fn(), create: jest.fn(), findById: jest.fn() };
    federatedIdentityService = { findUserId: jest.fn().mockResolvedValue(null), bind: jest.fn() };
    service = new PortalTokenService(userService as never, federatedIdentityService as never);
  });

  it('verifies against the portal JWKS with the configured issuer + audience', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { sub: 's1', email: 'liam@ci.computer' } });
    userService.create.mockResolvedValue({ id: 'u1' });

    await service.verifyAndProvision('the-token');

    expect(mockJwtVerify).toHaveBeenCalledWith('the-token', 'JWKS', {
      issuer: 'https://hub.test',
      // PORTAL_OIDC_AUDIENCE is a comma-separated list, split to an array so jose
      // accepts a token whose aud matches any first-party client.
      audience: ['ci-server', 'ci-import-tools', 'ci-even'],
    });
  });

  it('resolves an established (iss,sub) binding without touching email', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { iss: 'https://hub.test', sub: 's1', email: 'liam@ci.computer' },
    });
    federatedIdentityService.findUserId.mockResolvedValue('u-bound');
    userService.findById.mockResolvedValue({ id: 'u-bound' });

    expect(await service.verifyAndProvision('t')).toEqual({ id: 'u-bound' });
    expect(federatedIdentityService.findUserId).toHaveBeenCalledWith('https://hub.test', 's1');
    expect(userService.findByEmail).not.toHaveBeenCalled();
    expect(userService.create).not.toHaveBeenCalled();
  });

  it('JIT-provisions a new user and binds it on (iss,sub)', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { iss: 'https://hub.test', sub: 's1', email: 'liam@ci.computer', name: 'Liam' },
    });
    userService.findByEmail.mockResolvedValue(null);
    userService.create.mockResolvedValue({ id: 'u-new' });

    const user = await service.verifyAndProvision('t');

    expect(user).toEqual({ id: 'u-new' });
    expect(federatedIdentityService.bind).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-new',
        issuer: 'https://hub.test',
        subject: 's1',
        bindMethod: 'sub',
      }),
    );
  });

  it('links a pre-existing account by VERIFIED email exactly once', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { iss: 'https://hub.test', sub: 's1', email: 'liam@ci.computer', email_verified: true },
    });
    userService.findByEmail.mockResolvedValue({ id: 'u-existing' });

    expect(await service.verifyAndProvision('t')).toEqual({ id: 'u-existing' });
    expect(userService.create).not.toHaveBeenCalled();
    // The link is recorded so every LATER request for this (iss,sub) skips email.
    expect(federatedIdentityService.bind).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-existing', bindMethod: 'email_link' }),
    );
  });

  it('SECURITY: an unverified email never adopts an existing account', async () => {
    // The takeover shape: an attacker controls an unverified address at a
    // trusted issuer that collides with a local user. It must provision a NEW
    // account rather than inherit the victim's.
    mockJwtVerify.mockResolvedValue({
      payload: { iss: 'https://hub.test', sub: 'attacker-sub', email: 'liam@ci.computer' },
    });
    userService.findByEmail.mockResolvedValue({ id: 'u-victim' });
    userService.create.mockResolvedValue({ id: 'u-fresh' });

    expect(await service.verifyAndProvision('t')).toEqual({ id: 'u-fresh' });
    expect(federatedIdentityService.bind).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-fresh', subject: 'attacker-sub', bindMethod: 'sub' }),
    );
  });

  it('falls back to a deterministic shadow email when the token has no email', async () => {
    mockJwtVerify.mockResolvedValue({ payload: { iss: 'https://hub.test', sub: 'sub-xyz' } });
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

  describe('verifyClaims', () => {
    it('returns claims WITHOUT provisioning a local user (peer path)', async () => {
      mockJwtVerify.mockResolvedValue({ payload: { iss: 'https://hub.test', sub: 'peer-sub' } });

      expect(await service.verifyClaims('t')).toEqual({
        issuer: 'https://hub.test',
        subject: 'peer-sub',
      });
      // The whole point: a peer must never mint a shadow account here.
      expect(userService.create).not.toHaveBeenCalled();
      expect(federatedIdentityService.bind).not.toHaveBeenCalled();
    });

    it('returns null for an invalid token', async () => {
      mockJwtVerify.mockRejectedValue(new Error('bad'));

      expect(await service.verifyClaims('bad')).toBeNull();
    });
  });
});
