import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { FeatureService } from '@ci/common/feature';
import { PORTAL_TOKEN_VERIFIER, type PortalTokenVerifier } from '@ci/common/guards/PortalTokenVerifier';
import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

import { PEER_ASK_ID_PATTERN, peerAskBodySchema, type PeerAskResponse } from '../protocol';
import { PeerAskService } from '../services/PeerAskService';
import { PeerRateLimitService } from '../services/PeerRateLimitService';

/**
 * `/agent/v1` — the peer-facing surface, and the ONLY route another Companion
 * can reach.
 *
 * It is deliberately separate from the main API: it authenticates a *peer*
 * rather than a local user, so it does not use `JwtOrApiKeyAuthGuard` (whose
 * portal path JIT-provisions a local account — exactly what must not happen for
 * a peer). Instead it verifies the Portal token's claims only, then hands the
 * (issuer, subject) pair to the peer-link layer for attribution.
 *
 * ADR-0005 designates a dedicated `ci-mcp` adapter as the long-term external
 * boundary; until that lands this controller is the narrow, single-purpose
 * stand-in, gated by the `ask` feature flag (on by default since 2026-08-17).
 * The flag alone does not open this route: it also requires `peers.audience`,
 * and refuses every request until an operator binds one.
 */
@Controller('agent/v1')
export class PeerAskController {
  constructor(
    @Inject(PORTAL_TOKEN_VERIFIER)
    private readonly portalTokenVerifier: PortalTokenVerifier,
    private readonly peerAskService: PeerAskService,
    private readonly rateLimitService: PeerRateLimitService,
    private readonly featureService: FeatureService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PeerAskController.name);
  }

  @Post('ask')
  async ask(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<PeerAskResponse> {
    const identity = await this.authenticate(authorization);

    // Rate-limit on the verified peer identity, BEFORE the peer-link lookup, so
    // an unlinked caller cannot hammer the endpoint for free.
    this.rateLimitService.consume(identity);

    const parsed = peerAskBodySchema.safeParse(body);
    if (!parsed.success) {
      // The body is attacker-controlled; reject anything off-contract outright.
      throw new BadRequestException('Malformed ask');
    }

    return this.peerAskService.handle(identity, parsed.data);
  }

  /**
   * Collect the answer to an ask this peer already sent — the return path for
   * an ask a HUMAN approved, which had no channel at all before.
   *
   * It is a READ. It evaluates no grant, runs no executor, creates no ask and
   * writes no audit row; it can only hand back a disclosure that already
   * happened. See {@link PeerAskService.result} for why a poll rather than a
   * callback, and why an unknown id answers `pending` instead of 404.
   *
   * The path segment is the asker's own correlation id (the body's `askId`),
   * never a local row id, so this route leaks no identifier of this box. Its
   * own rate-limit bucket keeps collecting an answer from spending the budget
   * that protects the owner's review inbox — see
   * {@link PeerRateLimitService.consumePoll}.
   *
   * ═══ WHY THE PARAM IS NOT CALLED `askId` ═══
   *
   * `IdFormatGuard` is a GLOBAL guard that 404s any route parameter whose NAME
   * matches `/id$/i` and whose VALUE is not a uuid. Every local route it was
   * written for passes a local row id, so that is a sound assumption there — and
   * completely wrong here: a correlation id is minted by the PEER, is opaque to
   * this box by design, and is bounded by {@link PEER_ASK_ID_PATTERN} rather
   * than by uuid syntax.
   *
   * Naming it `askId` made every collect return `404 Not Found` — reproduced
   * against two real boxes, with the repeat-POST replay working perfectly
   * beside it, so it read as "the answer is not there" rather than "the route
   * is not reachable". Renaming the parameter is the fix: relaxing a global
   * guard so one route can accept non-uuid ids would weaken it for every route
   * that legitimately depends on it.
   */
  @Get('ask/:correlation')
  async result(
    @Headers('authorization') authorization: string | undefined,
    @Param('correlation') askId: string,
  ): Promise<PeerAskResponse> {
    const identity = await this.authenticate(authorization);

    this.rateLimitService.consumePoll(identity);

    // The same bound `peerAskBodySchema` puts on `askId` — one definition, so
    // the two routes cannot disagree about which ids exist. This route has no
    // body, so nothing else would apply it.
    if (!PEER_ASK_ID_PATTERN.test(askId)) {
      throw new BadRequestException('Malformed ask');
    }

    return this.peerAskService.result(identity, askId);
  }

  /**
   * The gates every peer-facing route shares, in the order they have to run:
   * feature flag, bearer token, configured audience, verified claims. Factored
   * out rather than copied so a second route cannot quietly acquire a weaker
   * set — which is how a poll endpoint would have become the way in.
   */
  private async authenticate(
    authorization: string | undefined,
  ): Promise<{ issuer: string; subject: string }> {
    if (!(await this.featureService.isFeatureEnabled('ask'))) {
      // Dark by default: indistinguishable from a box that has no peer surface.
      throw new ServiceUnavailableException('Peer asks are not enabled');
    }

    const token = extractBearer(authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    // The token must be addressed to THIS box. Without a configured audience a
    // token minted for any first-party client — including one issued for a
    // different Companion — would verify here, so the surface refuses to accept
    // anything until an operator has bound it.
    const audience = config.peers?.audience?.trim();
    if (!audience) {
      this.logger.warn('peer ask refused: peers.audience is not configured');
      throw new ServiceUnavailableException('Peer asks are not enabled');
    }

    // Claims only — never provision a local user for a peer.
    const identity = await this.portalTokenVerifier.verifyClaims(token, { audience: [audience] });
    if (!identity) {
      throw new UnauthorizedException('Invalid token');
    }

    return identity;
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(' ');

  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
}
