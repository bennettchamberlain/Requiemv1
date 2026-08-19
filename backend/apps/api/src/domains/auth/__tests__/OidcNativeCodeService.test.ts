import { OidcNativeCodeService } from '../services/OidcNativeCodeService';

describe('OidcNativeCodeService', () => {
  let service: OidcNativeCodeService;

  beforeEach(() => {
    service = new OidcNativeCodeService();
    jest.useRealTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('issues a high-entropy, opaque code (no userId leaked into the code)', () => {
    const code = service.issue('user-123');

    expect(typeof code).toBe('string');
    // 32 random bytes base64url-encoded → 43 chars.
    expect(code.length).toBeGreaterThanOrEqual(43);
    expect(code).not.toContain('user-123');
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('redeems a valid code exactly once (single use / replay-safe)', () => {
    const code = service.issue('user-123');

    expect(service.redeem(code)).toBe('user-123');
    // Second attempt must fail — the code is consumed.
    expect(service.redeem(code)).toBeNull();
  });

  it('returns null for an unknown or empty code', () => {
    expect(service.redeem('does-not-exist')).toBeNull();
    expect(service.redeem('')).toBeNull();
  });

  it('issues distinct codes for repeated calls', () => {
    const a = service.issue('user-123');
    const b = service.issue('user-123');

    expect(a).not.toBe(b);
    expect(service.redeem(a)).toBe('user-123');
    expect(service.redeem(b)).toBe('user-123');
  });

  it('keeps codes bound to the right user', () => {
    const codeA = service.issue('user-A');
    const codeB = service.issue('user-B');

    expect(service.redeem(codeB)).toBe('user-B');
    expect(service.redeem(codeA)).toBe('user-A');
  });

  it('rejects a code once it has expired (~2 min TTL)', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const code = service.issue('user-123');

    // Advance past the 2-minute TTL.
    jest.setSystemTime(new Date('2026-01-01T00:02:01Z'));

    expect(service.redeem(code)).toBeNull();
  });

  it('still accepts a code just before it expires', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const code = service.issue('user-123');

    jest.setSystemTime(new Date('2026-01-01T00:01:59Z'));

    expect(service.redeem(code)).toBe('user-123');
  });
});
