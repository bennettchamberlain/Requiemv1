import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import {
  type Ask,
  AskAnswerService,
  AskAuditService,
  AskExecutorService,
  AskService,
  buildDisclosedAnswer,
  GrantService,
  type AskQuery,
} from '@ci/domains/asks';
import { EventEntity } from '@ci/domains/memory';

import { computeFreeBusy, summarizeAvailability } from '../availability';
import { type PeerLink } from '../entities/PeerLinkEntity';
import type { PeerAskBody, PeerAskResponse } from '../protocol';

import { PeerLinkService } from './PeerLinkService';

/**
 * Handles an INBOUND ask from a peer Companion.
 *
 * The pipeline is the one a local ask already runs, with two federation-specific
 * steps in front: attribute the caller to a known peer link, and translate the
 * wire archetype into the local ask vocabulary. Everything after that — consent
 * evaluation, run-as-owner execution, disclosure filtering, audit — is the
 * machinery Phases 0–1 built and tested. Federation adds a transport and an
 * identity, not a second policy engine.
 *
 *   verified (iss,sub) → peer link → ask record → grant eval
 *     → auto ? execute + disclose : queue for the owner's review inbox
 */
@Injectable()
export class PeerAskService {
  constructor(
    private readonly peerLinkService: PeerLinkService,
    private readonly askService: AskService,
    private readonly grantService: GrantService,
    private readonly executorService: AskExecutorService,
    private readonly answerService: AskAnswerService,
    private readonly auditService: AskAuditService,
    @InjectRepository(EventEntity)
    private readonly eventRepository: Repository<EventEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PeerAskService.name);
  }

  /**
   * Route and process an inbound peer ask. `peerIdentity` comes from a verified
   * Portal token; an unlinked or revoked peer is refused outright.
   */
  async handle(
    peerIdentity: { issuer: string; subject: string },
    body: PeerAskBody,
  ): Promise<PeerAskResponse> {
    const links = await this.peerLinkService.findActiveByPeerIdentity(
      peerIdentity.issuer,
      peerIdentity.subject,
    );

    // Not a linked (or no longer linked) peer. Refused without detail — a
    // stranger must not be able to distinguish "no such user on this box" from
    // "you are not linked to them".
    if (links.length === 0) {
      throw new ForbiddenException('No peer link');
    }
    // Multi-user household: refuse rather than answer as an arbitrary member.
    if (links.length > 1) {
      throw new ForbiddenException('Ambiguous peer link');
    }

    const link = links[0];
    const context: UserServiceContext = { userId: link.ownerUserId };
    const query = toAskQuery(body);

    const ask = await this.askService.create(context, {
      responderUserId: link.ownerUserId,
      query,
      peerLinkId: link.id,
      direction: 'inbound',
    });

    const decision = await this.grantService.evaluate(ask);

    if (decision.decision === 'deny') {
      await this.recordAudit(ask, link, decision.grantId ?? null, 'declined', []);

      // A decline is shaped exactly like "nothing found" — no probing signal.
      return { askId: body.askId, status: 'declined', reason: 'Not permitted' };
    }

    if (decision.decision !== 'auto') {
      // Needs the owner's eyes; it waits in their review inbox.
      return { askId: body.askId, status: 'pending_review', reason: 'Awaiting owner review' };
    }

    const answer = await this.answerFor(context, link, body, ask, decision.grantId ?? null);

    return { askId: body.askId, status: 'answered', answer };
  }

  /** Execute an authorized ask and build its disclosure-filtered answer. */
  private async answerFor(
    context: UserServiceContext,
    link: PeerLink,
    body: PeerAskBody,
    ask: Ask,
    consentBasis: string | null,
  ): Promise<NonNullable<PeerAskResponse['answer']>> {
    const who = link.displayName ?? 'They';

    // Availability has its own executor: it never touches the search index and
    // returns interval boundaries only, which is what makes it safe to
    // auto-answer under a standing grant.
    if (body.request.archetype === 'availability') {
      const from = new Date(body.request.from);
      const to = new Date(body.request.to);
      const events = await this.eventRepository.find({
        where: { user: { id: context.userId }, startTime: Between(from, to) },
        select: { startTime: true, endTime: true, isAllDay: true },
      });

      const freeBusy = computeFreeBusy(events, { from, to }, { minMinutes: body.request.minMinutes });
      await this.recordAudit(ask, link, consentBasis, 'auto_answered', []);

      return {
        form: 'availability',
        summary: summarizeAvailability(freeBusy, who),
        busy: freeBusy.busy,
        free: freeBusy.free,
      };
    }

    // relationship / content resolve through the shared run-as-owner executor
    // and the shared disclosure filter.
    const identifiers = await this.executorService.execute(ask);
    const matches = identifiers.map((identifier) => ({ id: identifier.id, type: identifier.type }));

    const disclosed = buildDisclosedAnswer({
      // "Do you know X?" is a yes/no; "have you seen X?" is existence. Neither
      // returns item references — only an explicit retrieval ask would, and the
      // peer protocol does not expose one.
      form: body.request.archetype === 'relationship' ? 'boolean' : 'existence',
      matches,
      consentBasis,
      responderLabel: who,
    });

    await this.answerService.create({ askId: ask.id, answer: disclosed });
    await this.recordAudit(
      ask,
      link,
      consentBasis,
      'auto_answered',
      matches.map((match) => match.id),
    );

    return {
      form: disclosed.form,
      summary: disclosed.summary,
      items: disclosed.items,
      disclosedCount: disclosed.disclosedCount,
      withheldCount: disclosed.withheldCount,
    };
  }

  private async recordAudit(
    ask: Ask,
    link: PeerLink,
    consentBasis: string | null,
    outcome: 'auto_answered' | 'declined',
    disclosedEntities: string[],
  ): Promise<void> {
    await this.auditService.record({
      askId: ask.id,
      askerUserId: ask.askerUserId,
      peerLinkId: link.id,
      peerHandle: link.peerHandle,
      responderUserId: ask.responderUserId,
      query: ask.query,
      consentBasis,
      outcome,
      disclosedEntities,
    });
  }
}

/** Translate a wire archetype into the local ask query vocabulary. */
export function toAskQuery(body: PeerAskBody): AskQuery {
  switch (body.request.archetype) {
    case 'relationship':
      return { queryType: 'relationship', prompt: body.request.subject };
    case 'content':
      return {
        queryType: 'content',
        dataClass: body.request.dataClass,
        prompt: body.request.subject,
        filters: { from: body.request.from, to: body.request.to },
      };
    case 'availability':
      return {
        queryType: 'availability',
        dataClass: 'calendar',
        prompt: body.request.purpose ?? body.prompt,
        filters: { from: body.request.from, to: body.request.to },
      };
  }
}
