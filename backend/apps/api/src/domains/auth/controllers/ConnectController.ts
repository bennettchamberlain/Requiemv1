import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { LoggerService } from '@ci/common/logging';
import { ValidationPipe } from '@ci/common/pipes';
import config from '@ci/configuration';

import { ConnectRequestAuthGuard } from '../guards/ConnectRequestAuthGuard';
import { CsrfGuard } from '../guards/CsrfGuard';
import { ConnectService } from '../services/ConnectService';
import { CsrfService } from '../services/CsrfService';
import { renderConnectConsentPage, renderConnectErrorPage } from '../utils/connectConsentPage';

const SESSION_COOKIE = config.auth.cookies.sessionTokenName;
const CSRF_COOKIE = config.auth.cookies.csrfTokenName;

const approveSchema = z.object({
  app: z.string().min(1),
  state: z.string().min(1),
  return: z.string().url(),
});

const exchangeSchema = z.object({
  code: z.string().min(1),
});

const revokeSchema = z.object({
  app: z.string().min(1),
});

const rotateSchema = z.object({
  app: z.string().min(1),
});

type ApproveDto = z.infer<typeof approveSchema>;
type ExchangeDto = z.infer<typeof exchangeSchema>;
type RevokeDto = z.infer<typeof revokeSchema>;
type RotateDto = z.infer<typeof rotateSchema>;

/**
 * App-connect endpoints. CI-Hub brokers connecting an agent app (OpenClaw /
 * Hermes / Import-Tools) to the user's Companion Memory:
 *
 *   GET  /api/connect          → consent (signing the user in first if needed)
 *   POST /api/connect/approve  → mint a scoped key, hand back a one-time code
 *   POST /api/connect/exchange → CI-Hub swaps the code for the raw key (S2S)
 *   POST /api/connect/revoke   → CI-Hub revokes the app's key (S2S)
 *   POST /api/connect/rotate   → CI-Hub rotates the app's key before expiry (S2S)
 *
 * The browser-facing routes run on this origin so the session cookie is in
 * scope; the raw key only ever leaves via the forward-auth-protected exchange.
 */
@Controller('connect')
export class ConnectController {
  constructor(
    private readonly connectService: ConnectService,
    private readonly csrfService: CsrfService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectController.name);
  }

  /**
   * Entry point. Validates the CI-Hub return URL, ensures the user is signed in
   * (bouncing through OIDC and back here if not), then renders the consent page.
   */
  @Get()
  async connect(
    @Query('app') app: string | undefined,
    @Query('state') state: string | undefined,
    @Query('return') returnUrl: string | undefined,
    @Query('app_name') appName: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!app || !state || !returnUrl) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .type('html')
        .send(renderConnectErrorPage('Missing required parameters.'));

      return;
    }

    // Open-redirect guard: only ever redirect back to an allowlisted CI-Hub origin.
    if (!this.connectService.isReturnUrlAllowed(returnUrl)) {
      this.logger.warn(`Rejected connect: return URL origin not allowlisted (app ${app})`);
      res
        .status(HttpStatus.BAD_REQUEST)
        .type('html')
        .send(renderConnectErrorPage('This connection request is not from a trusted source.'));

      return;
    }

    const session = await this.connectService.resolveSessionUser(req.cookies?.[SESSION_COOKIE]);

    if (!session) {
      // Sign in, then return to this exact URL (same-origin path passes the OIDC
      // controller's safeRelativePath guard) with the session cookie set. Carry
      // app_name through the bounce so the consent page can show the friendly
      // name rather than falling back to the raw URN.
      const selfParams = new URLSearchParams({ app, state, return: returnUrl });

      if (appName) {
        selfParams.set('app_name', appName);
      }

      const selfPath = `/api/connect?${selfParams.toString()}`;

      res.redirect(`/api/authenticate/oidc?redirect=${encodeURIComponent(selfPath)}`);

      return;
    }

    // The consent page's approve POST is CSRF-guarded (double-submit). A signed-in
    // user who did NOT just bounce through OIDC has no CSRF cookie (it is a
    // sameSite=strict session cookie that OIDC/login set), so mint one here —
    // otherwise the approve POST sends an empty token and fails with a 403.
    const csrfToken = this.csrfService.generateToken();
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      secure: req.secure,
      sameSite: 'strict',
      path: '/',
    });

    res
      .type('html')
      // Lock the consent page down to what it actually uses: inline script/style,
      // a same-origin fetch to /api/connect/approve, and JS navigation. default-src
      // 'none' + connect-src 'self' means even if attacker input ever slipped past
      // the page's escaping, it could not load an external resource or exfiltrate
      // over fetch/img/form; frame-ancestors/X-Frame-Options keep it un-framable.
      .header(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      )
      .header('X-Frame-Options', 'DENY')
      .send(
        renderConnectConsentPage({ appUrn: app, appName, state, returnUrl, csrfCookieName: CSRF_COOKIE }),
      );
  }

  /**
   * Consent approval. CSRF-guarded and re-checks the session and return origin,
   * then mints the scoped key and returns the CI-Hub redirect URL (carrying the
   * one-time code) for the consent page to navigate to.
   */
  @UseGuards(CsrfGuard)
  @Post('approve')
  async approve(@Body(new ValidationPipe(approveSchema)) body: ApproveDto, @Req() req: Request) {
    const session = await this.connectService.resolveSessionUser(req.cookies?.[SESSION_COOKIE]);

    if (!session) {
      throw new UnauthorizedException('Not signed in');
    }

    if (!this.connectService.isReturnUrlAllowed(body.return)) {
      throw new BadRequestException('Return URL origin is not allowlisted');
    }

    const { code } = await this.connectService.approve(session.userId, body.app);

    return { redirectUrl: this.connectService.buildReturnUrl(body.return, code, body.state) };
  }

  /**
   * Server-to-server code exchange. Authenticated by CI-Hub's signed, replay-
   * resistant request signature. Returns the raw scoped key exactly once.
   */
  @UseGuards(ConnectRequestAuthGuard)
  @Post('exchange')
  async exchange(@Body(new ValidationPipe(exchangeSchema)) body: ExchangeDto) {
    const result = await this.connectService.exchange(body.code);

    if (!result) {
      throw new BadRequestException('Invalid or expired connect code');
    }

    return result;
  }

  /**
   * Server-to-server revoke (agent uninstall, user disconnect, ci-memory reset).
   * Authenticated by CI-Hub's signed, replay-resistant request signature.
   */
  @UseGuards(ConnectRequestAuthGuard)
  @Post('revoke')
  async revoke(@Body(new ValidationPipe(revokeSchema)) body: RevokeDto) {
    const revoked = await this.connectService.revokeByApp(body.app);

    return { revoked };
  }

  /**
   * Server-to-server key rotation (refresh before expiry). Re-mints the app's
   * memory key for the same user and returns the new raw key. Authenticated by
   * CI-Hub's signed, replay-resistant request signature.
   */
  @UseGuards(ConnectRequestAuthGuard)
  @Post('rotate')
  async rotate(@Body(new ValidationPipe(rotateSchema)) body: RotateDto) {
    const result = await this.connectService.rotateByApp(body.app);

    if (!result) {
      throw new BadRequestException('No connected key to rotate for this app');
    }

    return result;
  }
}
