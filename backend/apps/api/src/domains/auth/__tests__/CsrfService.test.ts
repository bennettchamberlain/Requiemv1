import { ForbiddenException } from '@nestjs/common';

import { CsrfService } from '../services/CsrfService';

/**
 * Unit tests for the signed double-submit CSRF token service, with real crypto
 * (the HMAC secret comes from the test config). The `ensureToken` matrix is the
 * contract the stable-token design rests on: every render/refresh site reuses a
 * valid cookie and only mints when the cookie is absent or invalid, so a
 * background session refresh can never invalidate a token already embedded in
 * an open page (CI-Server#1740).
 */
describe('CsrfService', () => {
  const service = new CsrfService();

  describe('generateToken / verifyToken', () => {
    it('round-trips: generated tokens verify', () => {
      const token = service.generateToken();

      expect(token).toMatch(/^[0-9a-f]{64}\.[0-9a-f]{64}$/);
      expect(service.verifyToken(token)).toBe(true);
    });

    it('generates unique tokens', () => {
      expect(service.generateToken()).not.toBe(service.generateToken());
    });

    it('rejects a tampered random part', () => {
      const token = service.generateToken();
      const [random, signature] = token.split('.');
      const flipped = (random[0] === 'a' ? 'b' : 'a') + random.slice(1);

      expect(service.verifyToken(`${flipped}.${signature}`)).toBe(false);
    });

    it('rejects a tampered signature', () => {
      const token = service.generateToken();
      const [random, signature] = token.split('.');
      const flipped = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);

      expect(service.verifyToken(`${random}.${flipped}`)).toBe(false);
    });

    it('rejects malformed tokens', () => {
      expect(service.verifyToken('')).toBe(false);
      expect(service.verifyToken('no-dot')).toBe(false);
      expect(service.verifyToken('short.sig')).toBe(false);
    });
  });

  describe('ensureToken', () => {
    it('reuses a valid existing token unchanged', () => {
      const existing = service.generateToken();

      expect(service.ensureToken(existing)).toBe(existing);
    });

    it('mints when the cookie is absent', () => {
      const token = service.ensureToken(undefined);

      expect(service.verifyToken(token)).toBe(true);
    });

    it('mints when the cookie is empty', () => {
      const token = service.ensureToken('');

      expect(service.verifyToken(token)).toBe(true);
      expect(token).not.toBe('');
    });

    it('mints a fresh token when the cookie is invalid (e.g. signed with a rotated secret)', () => {
      const invalid = 'deadbeef.deadbeef';
      const token = service.ensureToken(invalid);

      expect(token).not.toBe(invalid);
      expect(service.verifyToken(token)).toBe(true);
    });
  });

  describe('validateToken (double-submit equality is load-bearing)', () => {
    it('accepts a matching valid pair', () => {
      const token = service.generateToken();

      expect(() => service.validateToken(token, token)).not.toThrow();
    });

    it('rejects when either side is missing', () => {
      const token = service.generateToken();

      expect(() => service.validateToken(undefined, token)).toThrow(ForbiddenException);
      expect(() => service.validateToken(token, undefined)).toThrow(ForbiddenException);
    });

    it('rejects two DIFFERENT validly-signed tokens (equality, not just signature)', () => {
      // Tokens are not session-bound, so an attacker could harvest a valid
      // token from their own browser; only the cookie↔field equality ties the
      // request to this browser's cookie jar. Must never regress.
      const cookie = service.generateToken();
      const field = service.generateToken();

      expect(() => service.validateToken(cookie, field)).toThrow(ForbiddenException);
    });

    it('rejects an unsigned but equal pair', () => {
      expect(() => service.validateToken('forged.forged', 'forged.forged')).toThrow(ForbiddenException);
    });
  });
});
