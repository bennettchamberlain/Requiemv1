import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

import config from '@ci/configuration';

import { CsrfService } from '../services/CsrfService';

const CSRF_COOKIE_NAME = config.auth.cookies.csrfTokenName;
const CSRF_HEADER_NAME = 'x-csrf-token';

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrfService: CsrfService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const cookieToken = req.cookies?.[CSRF_COOKIE_NAME] as string | undefined;
    const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

    if (cookieToken) {
      // Browser clients: strict signed double-submit — the cookie and header must
      // both be present, match, and carry a valid signature.
      this.csrfService.validateToken(cookieToken, headerToken);
    } else if (!this.csrfService.verifyToken(headerToken)) {
      // Cookie-less clients (the native app carries no ambient session cookie and
      // authenticates via an API key, so cookie-replay CSRF doesn't apply; a
      // cross-site caller also cannot set a custom request header). Require a
      // validly-signed token presented in the header alone.
      throw new ForbiddenException('Missing or invalid CSRF token');
    }

    return true;
  }
}
