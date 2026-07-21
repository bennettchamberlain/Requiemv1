import type { Request, Response } from 'express';
import parseDuration from 'parse-duration';

import config from '@ci/configuration';

import type { CsrfService } from '../services/CsrfService';

const CSRF_COOKIE_NAME = config.auth.cookies.csrfTokenName;

/**
 * Match the session cookie's lifetime so the pair lives and dies together.
 * Previously the csrf cookie was session-lived (no maxAge) while sessionToken
 * persisted for the refresh-token lifetime — after a browser restart the
 * mount-time /authenticate/refresh failed CSRF ("Missing CSRF token") despite a
 * perfectly valid session, forcing a needless re-login.
 */
const CSRF_COOKIE_MAX_AGE = parseDuration(config.auth.jwt.refreshTokenExpiration) ?? 0;

/**
 * Single source of truth for the csrf cookie's attributes. `httpOnly: false`
 * is required by the double-submit pattern (the SPA reads the cookie to set
 * the X-CSRF-Token header); `secure` mirrors the actual connection so plain-
 * HTTP Tailscale deployments keep working (see docs/api/auth-and-conventions.md).
 */
export function setCsrfCookie(req: Request, res: Response, token: string): void {
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: req.secure,
    sameSite: 'strict',
    path: '/',
    maxAge: CSRF_COOKIE_MAX_AGE,
  });
}

export function clearCsrfCookie(req: Request, res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: req.secure,
    sameSite: 'strict',
    path: '/',
  });
}

/**
 * Reuse the browser's existing csrf token when its signature is valid, minting
 * one only when it is absent or invalid. Always re-sets the cookie so the
 * maxAge slides alongside the session. Returns the token in effect, for
 * embedding in server-rendered forms.
 */
export function ensureCsrfCookie(csrfService: CsrfService, req: Request, res: Response): string {
  const token = csrfService.ensureToken(req.cookies?.[CSRF_COOKIE_NAME]);

  setCsrfCookie(req, res, token);

  return token;
}
