import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import { FeatureService } from '@ci/common/feature';
import { PORTAL_TOKEN_VERIFIER, type PortalTokenVerifier } from '@ci/common/guards/PortalTokenVerifier';
import { LoggerService } from '@ci/common/logging';

import { peerAskBodySchema, type PeerAskResponse } from '../protocol';
import { PeerAskService } from '../services/PeerAskService';

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
 * stand-in, gated by the `ask` feature flag (off by default).
 */
@Controller('agent/v1')
export class PeerAskController {
  constructor(
    @Inject(PORTAL_TOKEN_VERIFIER)
    private readonly portalTokenVerifier: PortalTokenVerifier,
    private readonly peerAskService: PeerAskService,
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
    if (!(await this.featureService.isFeatureEnabled('ask'))) {
      // Dark by default: indistinguishable from a box that has no peer surface.
      throw new ServiceUnavailableException('Peer asks are not enabled');
    }

    const token = extractBearer(authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    // Claims only — never provision a local user for a peer.
    const identity = await this.portalTokenVerifier.verifyClaims(token);
    if (!identity) {
      throw new UnauthorizedException('Invalid token');
    }

    const parsed = peerAskBodySchema.safeParse(body);
    if (!parsed.success) {
      // The body is attacker-controlled; reject anything off-contract outright.
      throw new BadRequestException('Malformed ask');
    }

    return this.peerAskService.handle(identity, parsed.data);
  }
}

function extractBearer(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(' ');

  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
}
