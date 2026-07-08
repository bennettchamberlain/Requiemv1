import { Injectable } from '@nestjs/common';

import { SYSTEM_USER } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';
import { UserService } from '@ci/domains/user';

import { ApiKeyService } from './ApiKeyService';
import { AuthService } from './AuthService';
import { ConnectCodeService } from './ConnectCodeService';

/** Scope granted to keys minted through the connect flow — memory access only. */
export const CONNECT_KEY_SCOPE = 'memory';
/** Api-key name prefix; the app URN makes the name unique per app (idempotency key). */
const CONNECT_KEY_NAME_PREFIX = 'app:';
/** Minted keys expire after this many days; CI-Hub rotates well before expiry. */
const CONNECT_KEY_TTL_DAYS = 90;

/**
 * The result of an approved connect: a one-time code for CI-Hub to exchange.
 */
export interface ApprovedConnect {
  /** One-time code to hand back to CI-Hub (in the redirect). */
  code: string;
}

/**
 * The result of exchanging a connect code: the raw scoped api key.
 */
export interface ExchangedConnect {
  /** The app URN the key was minted for. */
  appUrn: string;
  /** The raw memory-scoped api key (revealed exactly once). */
  key: string;
}

/**
 * Orchestrates the app-connect flow: turning a consenting, signed-in user into
 * a durable, memory-scoped api key that CI-Hub injects into an agent app.
 *
 * This is the identity anchor for the whole feature — the key is minted under
 * the user who actually signed in and consented, so it unlocks exactly their
 * memory (no forward-auth identity guessing). The raw key is handed to CI-Hub
 * out-of-band via a one-time code ({@link ConnectCodeService}); it never
 * transits the browser.
 */
@Injectable()
export class ConnectService {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly apiKeyService: ApiKeyService,
    private readonly connectCodeService: ConnectCodeService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectService.name);
  }

  /**
   * Resolve the signed-in user from a CI-Server session cookie, or `null` when
   * the cookie is missing/invalid or the user no longer exists.
   *
   * Validates the session JWT signature/expiry and confirms the user row still
   * exists. (Full session-revocation checking is out of scope here — the flow
   * is a short, top-level, user-initiated navigation, and the minted key is the
   * durable credential, not this session.)
   */
  async resolveSessionUser(sessionToken: string | undefined): Promise<{ userId: string } | null> {
    if (!sessionToken) {
      return null;
    }

    let userId: string;

    try {
      userId = this.authService.validateSessionToken(sessionToken).sub;
    } catch {
      return null;
    }

    const user = await this.userService.findById({ userId: SYSTEM_USER }, userId);

    if (!user) {
      return null;
    }

    return { userId: user.id };
  }

  /**
   * Whether `returnUrl`'s origin is an allowlisted CI-Hub origin. This is the
   * open-redirect guard for the single cross-origin hop back to CI-Hub; the
   * allowlist is provisioned by CI-Hub at install (`CI_HUB_ORIGINS`).
   */
  isReturnUrlAllowed(returnUrl: string): boolean {
    const allowed = this.allowedHubOrigins();

    if (allowed.length === 0) {
      return false;
    }

    let origin: string;

    try {
      origin = new URL(returnUrl).origin;
    } catch {
      return false;
    }

    return allowed.includes(origin);
  }

  /**
   * Mint (or rotate) the memory-scoped key for `(userId, appUrn)` and issue a
   * one-time code that CI-Hub can exchange for it.
   */
  async approve(userId: string, appUrn: string): Promise<ApprovedConnect> {
    const expiresAt = new Date(Date.now() + CONNECT_KEY_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const minted = await this.apiKeyService.createOrRotate(
      { userId },
      {
        name: this.keyName(appUrn),
        scopes: [CONNECT_KEY_SCOPE],
        expires_at: expiresAt,
      },
    );

    const code = await this.connectCodeService.issue(userId, appUrn, minted.key);

    this.logger.log(`Approved memory connect for app ${appUrn} (user ${userId})`);

    return { code };
  }

  /**
   * Exchange a one-time code for the raw minted key, or `null` if invalid.
   */
  async exchange(code: string): Promise<ExchangedConnect | null> {
    const consumed = await this.connectCodeService.consume(code);

    if (!consumed) {
      return null;
    }

    return { appUrn: consumed.appUrn, key: consumed.key };
  }

  /**
   * Revoke the memory key minted for `appUrn`, by its stable name. Called by the
   * trusted Hub path (agent uninstall, user "Disconnect", ci-memory reset) which
   * identifies the app but not the owning user. Idempotent: returns the number
   * of keys removed (0 when nothing was connected).
   */
  async revokeByApp(appUrn: string): Promise<number> {
    const removed = await this.apiKeyService.removeByName(this.keyName(appUrn));

    if (removed > 0) {
      this.logger.log(`Revoked memory connect for app ${appUrn} (${removed} key(s))`);
    }

    return removed;
  }

  /**
   * Build the redirect URL back to CI-Hub, carrying the one-time `code` and the
   * caller's opaque `state`. Caller must have validated `returnUrl` via
   * {@link isReturnUrlAllowed} first.
   */
  buildReturnUrl(returnUrl: string, code: string, state: string): string {
    const url = new URL(returnUrl);

    url.searchParams.set('code', code);
    url.searchParams.set('state', state);

    return url.toString();
  }

  /** The idempotent api-key name for an app URN. */
  private keyName(appUrn: string): string {
    return `${CONNECT_KEY_NAME_PREFIX}${appUrn}`;
  }

  /** Parse + normalise the configured CI-Hub origin allowlist. */
  private allowedHubOrigins(): string[] {
    return config.auth.connect.hubOrigins
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .map((entry) => {
        try {
          return new URL(entry).origin;
        } catch {
          this.logger.warn(`Ignoring malformed CI_HUB_ORIGINS entry: ${entry}`);

          return '';
        }
      })
      .filter((origin) => origin.length > 0);
  }
}
