import { ForbiddenException } from '@nestjs/common';

import { CsrfService } from '../CsrfService';

/**
 * Exercises the REAL HMAC, not a stub.
 *
 * Every other CSRF assertion in this codebase runs against a mocked `verifyToken`, so
 * the signature check itself has never executed in a test — even though it is the only
 * thing protecting the cookie-less NATIVE login path. On native there is no CSRF
 * cookie to double-submit (the SameSite cookie cannot ride a cross-origin webview
 * request), so `CsrfGuard` falls back to verifying the header token's signature alone.
 * If `verifyToken` ever returned true for an unsigned or tampered value, that path
 * would accept forged requests outright.
 *
 * These use the service's own crypto end to end: generate a token, then try to break it.
 */
describe('CsrfService', () => {
  const service = new CsrfService();

  describe('generateToken', () => {
    it('issues a `{random}.{hmac}` token that verifies', () => {
      const token = service.generateToken();

      expect(token).toMatch(/^[0-9a-f]{64}\.[0-9a-f]{64}$/);
      expect(service.verifyToken(token)).toBe(true);
    });

    it('never issues the same token twice', () => {
      const tokens = new Set(Array.from({ length: 50 }, () => service.generateToken()));

      expect(tokens.size).toBe(50);
    });
  });

  describe('verifyToken — forgery rejection (the native path depends on this)', () => {
    it('rejects a tampered signature', () => {
      const [random] = service.generateToken().split('.');
      const forged = `${random}.${'a'.repeat(64)}`;

      expect(service.verifyToken(forged)).toBe(false);
    });

    it('rejects a token whose random half was swapped for another valid token’s', () => {
      // Mixing halves of two legitimately-issued tokens must not produce a valid one.
      const [randomA] = service.generateToken().split('.');
      const [, signatureB] = service.generateToken().split('.');

      expect(service.verifyToken(`${randomA}.${signatureB}`)).toBe(false);
    });

    it('rejects an unsigned value, even a well-formed-looking one', () => {
      expect(service.verifyToken('a'.repeat(64))).toBe(false);
      expect(service.verifyToken(`${'a'.repeat(64)}.`)).toBe(false);
    });

    it('rejects empty, undefined and dot-less input rather than throwing', () => {
      // The guard hands a possibly-absent header straight through, so this must be
      // total: any failure to parse is a rejection, never an exception or a pass.
      expect(service.verifyToken(undefined)).toBe(false);
      expect(service.verifyToken('')).toBe(false);
      expect(service.verifyToken('no-dot-here')).toBe(false);
    });

    it('rejects a signature of the wrong length without throwing', () => {
      // timingSafeEqual throws on length mismatch, so this must be length-checked
      // first — otherwise a short signature 500s instead of returning 403.
      const [random] = service.generateToken().split('.');

      expect(() => service.verifyToken(`${random}.abc`)).not.toThrow();
      expect(service.verifyToken(`${random}.abc`)).toBe(false);
    });

    it('is case-sensitive about the hex signature', () => {
      const token = service.generateToken();

      expect(service.verifyToken(token.toUpperCase())).toBe(false);
    });
  });

  describe('validateToken — the web double-submit path', () => {
    it('accepts a matching, correctly-signed cookie/header pair', () => {
      const token = service.generateToken();

      expect(() => service.validateToken(token, token)).not.toThrow();
    });

    it('rejects when either half is missing', () => {
      const token = service.generateToken();

      expect(() => service.validateToken(undefined, token)).toThrow(ForbiddenException);
      expect(() => service.validateToken(token, undefined)).toThrow(ForbiddenException);
      expect(() => service.validateToken(undefined, undefined)).toThrow(ForbiddenException);
    });

    it('rejects two DIFFERENT validly-signed tokens (the actual CSRF attack shape)', () => {
      // An attacker who can obtain their own legitimate token must not be able to pair
      // it with the victim's cookie.
      expect(() => service.validateToken(service.generateToken(), service.generateToken())).toThrow(
        ForbiddenException,
      );
    });

    it('rejects a matching pair that is not signed by this server', () => {
      // Same value in both places passes the double-submit check, so the signature is
      // the only thing left to stop a client-chosen token.
      const selfMinted = `${'a'.repeat(64)}.${'b'.repeat(64)}`;

      expect(() => service.validateToken(selfMinted, selfMinted)).toThrow(ForbiddenException);
    });

    it('rejects a length mismatch without throwing a non-Forbidden error', () => {
      const token = service.generateToken();

      // Must surface as 403, not a 500 out of timingSafeEqual.
      expect(() => service.validateToken(token, token.slice(0, -1))).toThrow(ForbiddenException);
    });
  });
});
