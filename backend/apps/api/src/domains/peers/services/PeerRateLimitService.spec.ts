import { PeerRateLimitService } from './PeerRateLimitService';

function makeService() {
  return new PeerRateLimitService({ setContext: jest.fn(), warn: jest.fn() } as never);
}

const PEER = { issuer: 'https://portal.example', subject: 'peer-1' };

describe('PeerRateLimitService', () => {
  it('allows a peer up to the window limit', () => {
    const service = makeService();
    for (let i = 0; i < 10; i++) {
      expect(() => service.consume(PEER, 1_000)).not.toThrow();
    }
  });

  it('throws 429 once the peer exceeds its window', () => {
    const service = makeService();
    for (let i = 0; i < 10; i++) {
      service.consume(PEER, 1_000);
    }

    expect(() => service.consume(PEER, 1_000)).toThrow();
  });

  it('keys on (issuer, subject) so one peer cannot exhaust another peer budget', () => {
    const service = makeService();
    for (let i = 0; i < 10; i++) {
      service.consume(PEER, 1_000);
    }

    // A different subject at the same issuer is unaffected.
    expect(() => service.consume({ ...PEER, subject: 'peer-2' }, 1_000)).not.toThrow();
    // As is the same subject at a different issuer.
    expect(() => service.consume({ ...PEER, issuer: 'https://other' }, 1_000)).not.toThrow();
  });

  it('recovers once the window slides past', () => {
    const service = makeService();
    for (let i = 0; i < 10; i++) {
      service.consume(PEER, 1_000);
    }

    expect(() => service.consume(PEER, 1_000)).toThrow();
    // 61s later the earlier attempts have aged out.
    expect(() => service.consume(PEER, 62_000)).not.toThrow();
  });
});
