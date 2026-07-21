import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { ForbiddenException, Injectable } from '@nestjs/common';

import config from '@ci/configuration';

const CSRF_SECRET = config.auth.csrf.secret;

/**
 * Implements the signed double-submit cookie pattern for CSRF protection.
 *
 * Token format: `{randomHex}.{hmacHex}`
 *
 * This service is responsible for generating and verifying CSRF tokens.
 * Cookie management and request validation are controller concerns.
 */
@Injectable()
export class CsrfService {
  /**
   * Generate a signed CSRF token.
   */
  generateToken(): string {
    const random = randomBytes(32).toString('hex');
    const signature = this.sign(random);

    return `${random}.${signature}`;
  }

  /**
   * Validate an CSRF token pair (cookie + header).
   *
   * Verifies that both values are present, match each other using a
   * constant-time comparison, and carry a valid HMAC signature.
   *
   * @throws ForbiddenException if validation fails
   */
  validateToken(cookieValue: string | undefined, headerValue: string | undefined): void {
    if (!cookieValue || !headerValue) {
      throw new ForbiddenException('Missing CSRF token');
    }

    // Compare BYTE lengths, not JS string lengths. `timingSafeEqual` rejects
    // buffers of differing byte length with a RangeError, and a multi-byte
    // character makes the two measures disagree ('é' is one JS char but two
    // bytes) — so a string-length guard lets such a pair through and the throw
    // escapes as a 500, bypassing the callers' CSRF self-heal handling.
    const cookieBytes = Buffer.from(cookieValue);
    const headerBytes = Buffer.from(headerValue);

    if (cookieBytes.length !== headerBytes.length) {
      throw new ForbiddenException('CSRF token mismatch');
    }

    if (!timingSafeEqual(cookieBytes, headerBytes)) {
      throw new ForbiddenException('CSRF token mismatch');
    }

    if (!this.verifyToken(cookieValue)) {
      throw new ForbiddenException('Invalid CSRF token');
    }
  }

  /**
   * Return the existing token when it carries a valid signature, otherwise mint
   * a fresh one.
   *
   * A CSRF token identifies a browser, not a request: reusing a valid cookie
   * keeps every open tab and server-rendered page (consent / confirm-account)
   * converged on one stable value, so a background session refresh can never
   * invalidate a form that was rendered earlier. Rotation is reserved for
   * identity boundaries (login, signup, OIDC sign-in) and logout (clear).
   */
  ensureToken(cookieValue: string | undefined): string {
    return cookieValue && this.verifyToken(cookieValue) ? cookieValue : this.generateToken();
  }

  /**
   * Verify the HMAC signature of a token.
   */
  verifyToken(token: string): boolean {
    const dotIndex = token.indexOf('.');

    if (dotIndex === -1) {
      return false;
    }

    const random = token.substring(0, dotIndex);
    const signature = token.substring(dotIndex + 1);

    const expectedSignature = this.sign(random);

    // Byte lengths again: the signature half comes from an attacker-settable
    // cookie, so it may contain multi-byte characters that match the expected
    // hex signature's JS length while differing in bytes.
    const signatureBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expectedSignature);

    if (signatureBytes.length !== expectedBytes.length) {
      return false;
    }

    return timingSafeEqual(signatureBytes, expectedBytes);
  }

  private sign(value: string): string {
    return createHmac('sha256', CSRF_SECRET).update(value).digest('hex');
  }
}
