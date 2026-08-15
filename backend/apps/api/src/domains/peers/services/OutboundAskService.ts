import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';
import { type Ask, AskAuditService, AskService } from '@ci/domains/asks';

import { type PeerLink } from '../entities/PeerLinkEntity';
import type { PeerAskBody, PeerAskRequest, PeerAskResponse } from '../protocol';

import { PeerAskClient } from './PeerAskClient';
import { PeerLinkService } from './PeerLinkService';

export interface SendAskDto {
  /** Portal handle of the peer to ask. */
  handle: string;
  prompt: string;
  request: PeerAskRequest;
}

export interface SendAskResult {
  ask: Ask;
  response: PeerAskResponse;
}

/**
 * The OUTBOUND half of a federated ask: composing a question, sending it to a
 * peer's Companion, and recording what came back.
 *
 * This is the counterpart to {@link PeerAskService} (inbound). Keeping them
 * separate matters: the inbound path treats the ask as hostile and the local
 * owner as authoritative, while this path treats the local user as authoritative
 * and the PEER'S RESPONSE as untrusted. Conflating them would blur which side of
 * the boundary each piece of data came from.
 *
 * The local `Ask` row is written before the request leaves, so an outbound ask
 * is auditable even when the peer never answers — a peer that goes silent still
 * leaves a record that this box asked.
 */
@Injectable()
export class OutboundAskService {
  constructor(
    private readonly peerLinkService: PeerLinkService,
    private readonly askService: AskService,
    private readonly auditService: AskAuditService,
    private readonly client: PeerAskClient,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(OutboundAskService.name);
  }

  /**
   * Send an ask to a linked peer.
   *
   * `accessToken` must be a Portal-issued token whose audience is the PEER box
   * (the peer verifies that binding on receipt). Until Portal token exchange
   * lands, the caller supplies it; this service never mints or caches one.
   */
  async send(context: UserServiceContext, dto: SendAskDto, accessToken: string): Promise<SendAskResult> {
    const link = await this.peerLinkService.findByHandle(context, dto.handle);

    if (link == null || link.status !== 'active') {
      // Unknown and revoked are reported identically — a caller cannot use this
      // to discover which handles the owner has ever been linked to.
      throw new NotFoundException('No active peer link for that handle');
    }

    if (!accessToken.trim()) {
      throw new BadRequestException('A peer access token is required');
    }

    const ask = await this.askService.create(context, {
      responderUserId: null,
      peerLinkId: link.id,
      direction: 'outbound',
      query: {
        queryType: dto.request.archetype,
        dataClass: dto.request.archetype === 'content' ? dto.request.dataClass : undefined,
        prompt: dto.prompt,
      },
    });

    const body = this.toBody(ask, link, dto);
    const response = await this.client.send(link, body, accessToken);

    await this.recordOutcome(ask, link, response);

    return { ask, response };
  }

  private toBody(ask: Ask, link: PeerLink, dto: SendAskDto): PeerAskBody {
    return {
      // A fresh correlation id per send — never the local row id, which would
      // leak this box's identifiers to the peer.
      askId: uuidv7(),
      askerHandle: config.peers?.handle ?? '',
      prompt: dto.prompt,
      request: dto.request,
    } as PeerAskBody;
  }

  /**
   * Fold the peer's reply into local state.
   *
   * The response is untrusted (already normalized by the client), so only the
   * STATUS drives the local lifecycle — never anything the peer says about what
   * it decided our policy was.
   */
  private async recordOutcome(ask: Ask, link: PeerLink, response: PeerAskResponse): Promise<void> {
    const outcome = response.status === 'answered' ? 'answered' : 'declined';

    await this.auditService.record({
      askId: ask.id,
      askerUserId: ask.askerUserId,
      responderUserId: null,
      peerLinkId: link.id,
      query: ask.query,
      consentBasis: null,
      outcome,
      // An outbound ask discloses nothing of ours; the entities in the reply are
      // the PEER's, and recording them here would imply we hold them.
      disclosedEntities: [],
    });
  }
}
