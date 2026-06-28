const mockPowersync = {
  url: '',
  jwtSecret: '',
  audience: 'powersync',
  tokenTtl: '300s',
  jwtKid: 'ci-powersync-hs256',
};

jest.mock('@ci/configuration', () => {
  const actual = jest.requireActual('@ci/configuration').default;

  return {
    __esModule: true,
    default: {
      ...actual,
      get powersync() {
        return mockPowersync;
      },
    },
  };
});

import { ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { PowerSyncTokenService } from '../services/PowerSyncTokenService';

interface DecodedToken {
  header: { kid?: string; alg?: string };
  payload: { sub?: string; aud?: string };
}

describe('PowerSyncTokenService', () => {
  let service: PowerSyncTokenService;

  beforeEach(() => {
    service = new PowerSyncTokenService(new JwtService({}));
    Object.assign(mockPowersync, {
      url: '',
      jwtSecret: '',
      audience: 'powersync',
      tokenTtl: '300s',
      jwtKid: 'ci-powersync-hs256',
    });
  });

  it('throws 503 when PowerSync is not configured', () => {
    expect(() => service.issueToken('user-1')).toThrow(ServiceUnavailableException);
  });

  it('issues a token scoped to the user (sub, aud, kid) when configured', () => {
    mockPowersync.url = 'https://ps.test';
    mockPowersync.jwtSecret = 'shh-secret';

    const { token, powersync_url } = service.issueToken('user-1');

    expect(powersync_url).toBe('https://ps.test');

    const decoded = new JwtService({}).decode(token, { complete: true }) as unknown as DecodedToken;

    expect(decoded.payload.sub).toBe('user-1');
    expect(decoded.payload.aud).toBe('powersync');
    expect(decoded.header.kid).toBe('ci-powersync-hs256');
    expect(decoded.header.alg).toBe('HS256');
  });
});
