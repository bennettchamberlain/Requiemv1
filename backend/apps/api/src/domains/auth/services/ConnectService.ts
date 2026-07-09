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
   * Issue a one-time code authorizing CI-Hub to mint the memory-scoped key for
   * `(userId, appUrn)`. The key itself is NOT minted here — deferring the mint
   * to {@link exchange} means an abandoned or failed flow never rotates (and so
   * never destroys) an app's existing, still-injected key.
   */
  async approve(userId: string, appUrn: string): Promise<ApprovedConnect> {
    const code = await this.connectCodeService.issue(userId, appUrn);

    this.logger.log(`Approved memory connect for app ${appUrn} (user ${userId})`);

    return { code };
  }

  /**
   * Redeem a one-time code and mint the memory-scoped key for the bound
   * `(user, app)`, rotating any existing key for that app. Returns the raw key
   * (revealed once), or `null` if the code is unknown/expired/already used.
   * Minting here — only on a successful, single-use redemption — is what makes
   * an interrupted re-consent safe for a currently-connected app.
   */
  async exchange(code: string): Promise<ExchangedConnect | null> {
    const consumed = await this.connectCodeService.consume(code);

    if (!consumed) {
      return null;
    }

    const expiresAt = new Date(Date.now() + CONNECT_KEY_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const minted = await this.apiKeyService.createOrRotate(
      { userId: consumed.userId },
      {
        name: this.keyName(consumed.appUrn),
        scopes: [CONNECT_KEY_SCOPE],
        expires_at: expiresAt,
      },
    );

    this.logger.log(`Minted memory key on exchange for app ${consumed.appUrn} (user ${consumed.userId})`);

    return { appUrn: consumed.appUrn, key: minted.key };
  }

  /**
   * Rotate the memory key for `appUrn`: mint a fresh key (new TTL) for the same
   * owning user, replacing the old one. Returns the new raw key, or null when no
   * key is currently connected for the app. Called by the trusted Hub path (key
   * rotation before expiry); no re-consent is needed because the user already
   * consented to the connection — this only refreshes the same grant.
   */
  async rotateByApp(appUrn: string): Promise<ExchangedConnect | null> {
    const name = this.keyName(appUrn);
    const userId = await this.apiKeyService.findUserIdByName(name);

    if (!userId) {
      return null;
    }

    const expiresAt = new Date(Date.now() + CONNECT_KEY_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const minted = await this.apiKeyService.createOrRotate(
      { userId },
      { name, scopes: [CONNECT_KEY_SCOPE], expires_at: expiresAt },
    );

    this.logger.log(`Rotated memory key for app ${appUrn} (user ${userId})`);

    return { appUrn, key: minted.key };
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
