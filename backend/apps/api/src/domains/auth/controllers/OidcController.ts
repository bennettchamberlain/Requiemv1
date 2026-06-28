import { createHash, randomBytes } from 'crypto';

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import parseDuration from 'parse-duration';
import { Agent, fetch as undiciFetch } from 'undici';
import { z } from 'zod';

import { SYSTEM_USER } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { LoggerService } from '@ci/common/logging';
import { ValidationPipe } from '@ci/common/pipes';
import config from '@ci/configuration';
import { UserService } from '@ci/domains/user';

import { AuthService } from '../services/AuthService';
import { CsrfService } from '../services/CsrfService';
import { OidcNativeCodeService } from '../services/OidcNativeCodeService';

const COOKIE_MAX_AGE = parseDuration(config.auth.jwt.refreshTokenExpiration) ?? 0;
const STATE_COOKIE = 'oidc_state';
const PKCE_COOKIE = 'oidc_pkce';
// Carries the "this flow was launched by the native app" signal through the IdP round
// trip. Set alongside state/pkce on initiate and read on callback; both cookies live on
// CI-Server's own domain in the SAME system browser, so they survive the redirect.
const CLIENT_COOKIE = 'oidc_client';
const NATIVE_CLIENT = 'native';

const nativeExchangeSchema = z.object({
  code: z.string().min(1),
});

// Allow self-signed certificates when the OIDC issuer is on localhost (dev only).
// Short keepAlive prevents stale connections to Wrangler's dev server from hanging.
const fetchDispatcher =
  process.env.NODE_ENV !== 'production' && config.auth.oidc.issuerUrl.includes('localhost')
    ? new Agent({
        connect: { rejectUnauthorized: false },
        keepAliveTimeout: 1_000,
        keepAliveMaxTimeout: 2_000,
      })
    : undefined;

/**
 * Generate a PKCE code_verifier and code_challenge (S256).
 */
function generatePkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  return { verifier, challenge };
}

/**
 * Handles the "Sign in with CI-Portal" OIDC authorization code flow with PKCE.
 *
 * GET /authenticate/oidc          → Redirects the browser to Portal's authorize endpoint
 * GET /authenticate/oidc/callback → Exchanges the code for tokens, resolves the user, issues a session
 */
@Controller('authenticate/oidc')
export class OidcController {
  constructor(
    private readonly userService: UserService,
    private readonly authService: AuthService,
    private readonly csrfService: CsrfService,
    private readonly featureService: FeatureService,
    private readonly oidcNativeCodeService: OidcNativeCodeService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(OidcController.name);
  }

  /** Build the native deep-link return URL (`<scheme>://oidc/callback?...`). */
  private nativeRedirectUrl(params: Record<string, string>): string {
    const scheme = config.auth.oidc.nativeRedirectScheme || 'companion';
    const search = new URLSearchParams(params).toString();

    return `${scheme}://oidc/callback${search ? `?${search}` : ''}`;
  }

  /**
   * Derive the callback URL from the current request's origin.
   * This removes the need for a static OIDC_CALLBACK_URL env var —
   * the callback is always relative to wherever CI-Server is running.
   */
  private getCallbackUrl(req: Request) {
    const proto = (req.headers['x-forwarded-proto'] as string) || (req.secure ? 'https' : 'http');
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost';

    return `${proto}://${host}/api/authenticate/oidc/callback`;
  }

  /**
   * Initiate the OIDC flow by redirecting to CI-Portal's authorize endpoint.
   */
  @Get()
  @HttpCode(302)
  initiate(@Query('client') client: string | undefined, @Req() req: Request, @Res() res: Response) {
    const { issuerUrl } = config.auth.oidc;

    if (!issuerUrl) {
      // Redirect to the login page with an error rather than dead-ending the
      // browser on a raw JSON 401 — the "Sign in with CI-Portal" button lands
      // here, so the user must end up somewhere they can recover from.
      this.logger.error('OIDC initiate blocked: OIDC_ISSUER_URL is not configured');

      return res.redirect('/login?error=oidc_not_configured');
    }

    const callbackUrl = this.getCallbackUrl(req);
    const state = randomBytes(32).toString('hex');
    const { verifier, challenge } = generatePkce();

    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: req.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 1000,
    });

    res.cookie(PKCE_COOKIE, verifier, {
      httpOnly: true,
      secure: req.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: 10 * 60 * 1000,
    });

    // Remember whether the native app launched this flow, so the callback returns the
    // result via the custom-scheme deep link instead of a browser session cookie.
    if (client === NATIVE_CLIENT) {
      res.cookie(CLIENT_COOKIE, NATIVE_CLIENT, {
        httpOnly: true,
        secure: req.secure,
        sameSite: 'lax',
        path: '/',
        maxAge: 10 * 60 * 1000,
      });
    }

    const authorizeUrl = new URL('/api/auth/oauth2/authorize', issuerUrl);

    authorizeUrl.searchParams.set('client_id', 'ci-server');
    authorizeUrl.searchParams.set('redirect_uri', callbackUrl);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('scope', 'openid email profile');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');

    res.redirect(authorizeUrl.toString());
  }

  /**
   * Handle the callback from CI-Portal after the user authenticates.
   */
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Whether the native app launched this flow (set on `initiate`). When native, every
    // exit — success or failure — returns via the custom-scheme deep link rather than a
    // browser redirect, so the system browser can hand control back to the app.
    const isNative = req.cookies?.[CLIENT_COOKIE] === NATIVE_CLIENT;

    res.clearCookie(CLIENT_COOKIE, {
      httpOnly: true,
      secure: req.secure,
      sameSite: 'lax',
      path: '/',
    });

    // Route a failure to the native deep link (`?error=...`) or the web login page.
    const failRedirect = (reason: string) =>
      isNative
        ? res.redirect(this.nativeRedirectUrl({ error: reason }))
        : res.redirect(`/login?error=${encodeURIComponent(reason)}`);

    if (error) {
      return failRedirect(error);
    }

    if (!code || !state) {
      return failRedirect('missing_params');
    }

    // Validate state matches cookie
    const storedState = req.cookies?.[STATE_COOKIE];

    if (!storedState || storedState !== state) {
      return failRedirect('invalid_state');
    }

    // Clear state cookie
    res.clearCookie(STATE_COOKIE, {
      httpOnly: true,
      secure: req.secure,
      sameSite: 'lax',
      path: '/',
    });

    // Retrieve and clear PKCE verifier
    const codeVerifier = req.cookies?.[PKCE_COOKIE];

    res.clearCookie(PKCE_COOKIE, {
      httpOnly: true,
      secure: req.secure,
      sameSite: 'lax',
      path: '/',
    });

    if (!codeVerifier) {
      return failRedirect('missing_pkce');
    }

    const { issuerUrl } = config.auth.oidc;

    if (!issuerUrl) {
      return failRedirect('oidc_not_configured');
    }

    const callbackUrl = this.getCallbackUrl(req);

    try {
      // Exchange code for tokens using PKCE (public client — no client_secret)
      const tokenResponse = await undiciFetch(new URL('/api/auth/oauth2/token', issuerUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: callbackUrl,
          client_id: 'ci-server',
          code_verifier: codeVerifier,
        }),
        dispatcher: fetchDispatcher,
        signal: AbortSignal.timeout(10_000),
      });

      if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.text();

        this.logger.error(`OIDC token exchange failed: ${tokenResponse.status} ${errorBody}`);

        return failRedirect('token_exchange_failed');
      }

      const tokens = (await tokenResponse.json()) as {
        access_token: string;
        id_token?: string;
        token_type: string;
      };

      // Fetch user info from Portal
      const userInfoResponse = await undiciFetch(new URL('/api/auth/oauth2/userinfo', issuerUrl), {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
          Accept: 'application/json',
        },
        dispatcher: fetchDispatcher,
        signal: AbortSignal.timeout(10_000),
      });

      if (!userInfoResponse.ok) {
        this.logger.error(`OIDC userinfo failed: ${userInfoResponse.status}`);

        return failRedirect('userinfo_failed');
      }

      const userInfo = (await userInfoResponse.json()) as {
        sub: string;
        email?: string;
        name?: string;
      };

      if (!userInfo.email) {
        return failRedirect('no_email');
      }

      // Find existing user or create a new one
      let user = await this.userService.findByEmail(userInfo.email);

      if (!user) {
        // Portal SSO must not bypass the signup-code gate: when codes are
        // required, only users that already exist on this server may sign in.
        const isSignupCodeRequired = await this.featureService.isFeatureEnabled('require.signup.codes');

        if (isSignupCodeRequired) {
          this.logger.warn(
            `OIDC sign-in rejected for unknown user (signup codes required): ${userInfo.email}`,
          );

          return failRedirect('signup_code_required');
        }

        // Auto-create account for Portal-authenticated users.
        // Generate a random password since they'll authenticate via OIDC.
        user = await this.userService.create(
          { userId: SYSTEM_USER },
          {
            name: userInfo.name || userInfo.email.split('@')[0],
            email: userInfo.email,
            password: randomBytes(32).toString('hex'),
          },
        );
      }

      // Native: do NOT set a browser session cookie (it cannot reach the app's webview
      // cross-origin). Instead mint a short-lived, single-use code and deep-link it back
      // to the app, which exchanges it for a JWT at /oidc/native/exchange. No long-lived
      // secret ever travels in the deep-link URL.
      if (isNative) {
        const oneTimeCode = this.oidcNativeCodeService.issue(user.id);

        return res.redirect(this.nativeRedirectUrl({ code: oneTimeCode }));
      }

      // Web: issue session tokens (same flow as local login).
      const sessionToken = await this.authService.issueSessionToken(
        user.id,
        this.authService.getSessionMetadata(req),
      );

      const csrfToken = this.csrfService.generateToken();

      res.cookie(config.auth.cookies.sessionTokenName, sessionToken, {
        httpOnly: true,
        secure: req.secure,
        sameSite: 'lax',
        path: '/',
        maxAge: COOKIE_MAX_AGE,
      });

      res.cookie(config.auth.cookies.csrfTokenName, csrfToken, {
        httpOnly: false,
        secure: req.secure,
        sameSite: 'strict',
        path: '/',
      });

      return res.redirect('/');
    } catch (err) {
      this.logger.error('OIDC callback error', err instanceof Error ? err.stack : String(err));

      return failRedirect('oidc_failed');
    }
  }

  /**
   * Native-only: exchange the short-lived one-time code delivered by the
   * `<scheme>://oidc/callback?code=...` deep link for a real access token (JWT). The app
   * then trades that JWT for a durable API key — the same credential path as password
   * login. The code is single-use and expires after ~2 minutes; redeeming it here
   * invalidates it, so it is replay-safe. Unauthenticated by design: the one-time code
   * IS the bearer of proof, and it never grants access beyond a single JWT issuance.
   */
  @Post('native/exchange')
  @HttpCode(200)
  nativeExchange(@Body(new ValidationPipe(nativeExchangeSchema)) input: { code: string }) {
    const userId = this.oidcNativeCodeService.redeem(input.code);

    if (!userId) {
      // Generic message — do not distinguish "expired" from "unknown" to a caller.
      this.logger.warn('OIDC native code exchange rejected (invalid or expired code)');

      throw new UnauthorizedException('Invalid or expired code');
    }

    const accessToken = this.authService.issueAccessToken(userId);

    return { accessToken };
  }
}
