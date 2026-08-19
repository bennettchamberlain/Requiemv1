import { randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';

/**
 * Issues and redeems short-lived, single-use one-time codes that carry an OIDC
 * sign-in result back into the NATIVE app via a custom-scheme deep link.
 *
 * Why a one-time code (and not the JWT itself) in the deep-link URL:
 *   - Deep-link URLs are visible to the OS, can land in logs, and on Android can in
 *     principle be intercepted by another app registering the same scheme. Putting a
 *     long-lived credential (JWT / API key) there would leak it.
 *   - Instead the URL carries a high-entropy, single-use code valid for ~2 minutes.
 *     The app immediately exchanges it over TLS at an authenticated endpoint for the
 *     real JWT (which it then trades for a durable API key, same as password login).
 *
 * Security properties:
 *   - The code is 32 bytes of CSPRNG randomness (base64url), not derivable.
 *   - The userId binding lives ONLY server-side in this store — the URL reveals nothing.
 *   - Redemption deletes the entry, so a code works at most once (replay-safe).
 *   - Entries expire after `TTL_MS`; expired entries are swept lazily on each issue.
 *
 * Storage is in-memory and therefore per-process. That is correct for the
 * single-instance appliance deployment. If CI-Server is ever horizontally scaled, this
 * must move to a shared store (e.g. the Postgres instance or Redis) so the exchange can
 * hit any instance — see the note in OidcController.
 */
@Injectable()
export class OidcNativeCodeService {
  private static readonly TTL_MS = 2 * 60 * 1000;

  private readonly store = new Map<string, { userId: string; expiresAt: number }>();

  /** Mint a single-use code bound to `userId`, valid for ~2 minutes. */
  issue(userId: string): string {
    this.sweepExpired();

    const code = randomBytes(32).toString('base64url');

    this.store.set(code, { userId, expiresAt: Date.now() + OidcNativeCodeService.TTL_MS });

    return code;
  }

  /**
   * Redeem a code: returns the bound userId and invalidates the code, or null if the
   * code is unknown, already used, or expired. Always single use.
   */
  redeem(code: string): string | null {
    if (!code) {
      return null;
    }

    const entry = this.store.get(code);

    // Delete first so even an expired/invalid attempt cannot be retried.
    this.store.delete(code);

    if (!entry || entry.expiresAt < Date.now()) {
      return null;
    }

    return entry.userId;
  }

  private sweepExpired(): void {
    const now = Date.now();

    for (const [code, entry] of this.store) {
      if (entry.expiresAt < now) {
        this.store.delete(code);
      }
    }
  }
}
