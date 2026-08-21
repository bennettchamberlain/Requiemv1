import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import {
  type Ask,
  AskAnswerService,
  AskAuditService,
  AskExecutorService,
  AskService,
  applyDisclosureCeiling,
  buildDisclosedAnswer,
  disclosureCeiling,
  minRung,
  GrantService,
  type AskQuery,
  type DisclosureRung,
} from '@ci/domains/asks';
import { EventEntity } from '@ci/domains/memory';

import { computeFreeBusy, summarizeAvailability, type FreeBusy } from '../availability';
import { type PeerLink } from '../entities/PeerLinkEntity';
import type { BusyInterval, PeerAskBody, PeerAskResponse } from '../protocol';

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
      // Persist the terminal state. Without this the ask stays `delivered`,
      // which `listInbox` surfaces as actionable — so the owner could later
      // "approve" an ask their own block grant already refused, and the block
      // would be silently overridden.
      const declined = await this.askService.systemTransition(ask.id, 'declined', {
        consentBasis: decision.grantId ?? null,
      });
      await this.recordAudit(declined, link, decision.grantId ?? null, 'declined', []);

      // A decline is shaped exactly like "nothing found" — no probing signal.
      return { askId: body.askId, status: 'declined', reason: 'Not permitted' };
    }

    if (decision.decision !== 'auto') {
      // Needs the owner's eyes; move it into the review queue explicitly rather
      // than leaving it in the delivered limbo.
      await this.askService.systemTransition(ask.id, 'under_review');

      return { askId: body.askId, status: 'pending_review', reason: 'Awaiting owner review' };
    }

    // Auto-authorized: record WHICH grant authorized it, so the answer and the
    // audit both carry a real consent basis rather than null — and the ceiling
    // that grant imposed AT THIS MOMENT, so a later revocation cannot widen a
    // re-run of the same ask (see {@link AskEntity.disclosureCeiling}).
    const authorized = await this.askService.setConsentBasis(
      ask.id,
      decision.grantId ?? null,
      decision.maxDisclosure ?? null,
    );

    const answer = await this.answerFor(
      context,
      link,
      body,
      authorized,
      decision.grantId ?? null,
      decision.maxDisclosure,
    );

    return { askId: body.askId, status: 'answered', answer };
  }

  /** Execute an authorized ask and build its disclosure-filtered answer. */
  private async answerFor(
    context: UserServiceContext,
    link: PeerLink,
    body: PeerAskBody,
    ask: Ask,
    consentBasis: string | null,
    grantCeiling?: DisclosureRung,
  ): Promise<NonNullable<PeerAskResponse['answer']>> {
    const who = link.displayName ?? 'They';

    // ═══ THE CEILING IS COMPUTED BEFORE THE ARCHETYPE BRANCH, NOT AFTER ═══
    //
    // It used to be computed below, on the relationship/content path only, and
    // the availability branch returned before ever reaching it. Both ceilings —
    // the tier the owner assigned this peer AND the deciding grant's own
    // `maxDisclosure` — were therefore skipped entirely for the one archetype
    // that answers straight out of the owner's calendar. Reproduced against
    // Postgres: `trustTier: 'stranger'` (tier ceiling `boolean`) plus a grant
    // carrying `maxDisclosure: 'none'` still handed the peer the owner's real
    // busy interval and both free windows, while the CONTENT archetype under
    // the identical `none` ceiling correctly returned "Nothing was shared."
    //
    // Two independent ceilings, combined by taking the LESSER: a grant can
    // tighten the tier default but never loosen it, so neither a generous grant
    // nor a generous tier alone can widen what a peer receives.
    //
    // The class comes from the ASK's own query rather than being re-derived per
    // archetype (`archetype === 'content' ? request.dataClass : undefined`).
    // `toAskQuery` already set it — 'calendar' for availability, the requested
    // class for content, absent for relationship — and reading it from one
    // place is what stops a fourth archetype from quietly inheriting
    // `undefined` the way availability inherited "no ceiling at all".
    const tierCeiling = disclosureCeiling(link.trustTier, ask.query.dataClass);
    const ceiling = grantCeiling != null ? minRung(tierCeiling, grantCeiling) : tierCeiling;

    // Availability has its own executor: it never touches the search index and
    // returns interval boundaries only, which is what makes it safe to
    // auto-answer under a standing grant — but "interval boundaries only" is a
    // statement about the SHAPE of the disclosure, not its size, and it is not
    // a reason to skip the ceiling.
    if (body.request.archetype === 'availability') {
      const { from, to } = boundedWindow(body.request.from, body.request.to);

      // OVERLAP, not containment. Filtering on `startTime BETWEEN from AND to`
      // misses the case that matters most: a meeting that began before the
      // window and is still running inside it (09:00–17:00 asked over 12:00–13:00
      // would load nothing and report the owner free through a four-hour
      // meeting). An event overlaps the window when it starts before the window
      // ends AND has not already finished when the window opens. `endTime` is
      // nullable, so open-ended events are matched on start alone and given a
      // default duration by computeFreeBusy.
      const events = await this.eventRepository.find({
        where: [
          {
            userId: context.userId,
            // Events are tombstoned, not destroyed (`EventService.softDeleteFlag`),
            // so a raw repository read has to skip flagged rows itself. Without
            // this a deleted meeting still marks the owner busy to a peer.
            isDeleted: false,
            startTime: LessThanOrEqual(to),
            endTime: MoreThanOrEqual(from),
          },
          {
            userId: context.userId,
            isDeleted: false,
            startTime: Between(from, to),
            endTime: IsNull(),
          },
        ],
        select: { startTime: true, endTime: true, isAllDay: true },
        take: MAX_AVAILABILITY_EVENTS,
      });

      const freeBusy = computeFreeBusy(events, { from, to }, { minMinutes: body.request.minMinutes });
      const answer = clampAvailability(freeBusy, ceiling, who);

      // The availability branch wrote NO `ci.ask_answers` row at all — the one
      // archetype with no ceiling was also the one with no record of what it
      // disclosed, so neither the owner's history nor an incident review could
      // reconstruct it. It is persisted under the `attribute` form (the
      // ask_answers CHECK admits the five local forms; `availability` is a WIRE
      // form, not a storage one) with the post-ceiling summary and no items,
      // which is exactly what crossed.
      await this.answerService.create({
        askId: ask.id,
        answer: {
          form: 'attribute',
          items: [],
          disclosedCount: answer.free.length,
          withheldCount: 0,
          summary: answer.summary,
          consentBasis,
        },
      });
      await this.recordAudit(ask, link, consentBasis, 'auto_answered', []);

      return { form: 'availability', summary: answer.summary, busy: answer.busy, free: answer.free };
    }

    // relationship / content resolve through the shared run-as-owner executor
    // and the shared disclosure filter.
    const identifiers = await this.executorService.execute(ask);
    const matches = identifiers.map((identifier) => ({ id: identifier.id, type: identifier.type }));

    const built = buildDisclosedAnswer({
      // "Do you know X?" is a yes/no; "have you seen X?" is existence. Neither
      // returns item references — only an explicit retrieval ask would, and the
      // peer protocol does not expose one.
      form: body.request.archetype === 'relationship' ? 'boolean' : 'existence',
      matches,
      consentBasis,
      responderLabel: who,
    });

    // Phase 2 policy engine — the same `ceiling` the availability branch above
    // now uses, computed once at the top of this method.
    const disclosed = applyDisclosureCeiling(built, ceiling);

    await this.answerService.create({ askId: ask.id, answer: disclosed });
    // Same split the local path makes: `disclosed.items` is what actually
    // crossed to the peer (empty here — the peer protocol exposes no retrieval
    // archetype), while the match set is the owner's own record of what the
    // answer was computed over. Recording the matches as DISCLOSED made the
    // audit over-report every federated answer.
    await this.recordAudit(
      ask,
      link,
      consentBasis,
      'auto_answered',
      disclosed.items.map((item) => item.id),
      matches.map((match) => match.id),
    );

    // CARDINALITY IS ITSELF A DISCLOSURE. A boolean answer ("do you know X?")
    // must carry no count, or the archetype degrades into a keyword-frequency
    // oracle over the responder's whole corpus: an asker could re-ask with
    // varied terms and read the match count each time. Only the `existence`
    // form is permitted to say *how much*, because that is what it means.
    const carriesCount = disclosed.form === 'existence' || disclosed.form === 'retrieval';

    return {
      form: disclosed.form,
      summary: disclosed.summary,
      items: disclosed.items,
      disclosedCount: carriesCount ? disclosed.disclosedCount : undefined,
      withheldCount: carriesCount ? disclosed.withheldCount : undefined,
    };
  }

  private async recordAudit(
    ask: Ask,
    link: PeerLink,
    consentBasis: string | null,
    outcome: 'auto_answered' | 'declined',
    disclosedEntities: string[],
    backingEntities: string[] = [],
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
      backingEntities,
    });
  }
}

/**
 * Clamp a free/busy answer down to a disclosure rung.
 *
 * `applyDisclosureCeiling` cannot do this job: it operates on a
 * {@link DisclosedAnswer}, whose unit of disclosure is an ITEM REFERENCE, and
 * an availability answer discloses interval BOUNDARIES instead. So the ladder
 * is spelled out here in the same shape and the same order, and it degrades the
 * same way — each rung strictly removes what the one above it revealed:
 *
 *   full / redacted — the busy and free intervals, as computed
 *   summary         — the templated sentence only (slot count + longest gap),
 *                     no boundaries. This is where the tier defaults land for
 *                     the `peer` tier.
 *   count           — how many free slots, with no durations and no boundaries
 *   boolean         — "is there any free time at all", nothing else. Where the
 *                     `stranger` tier lands, and where the reproduced bypass
 *                     was handing over the owner's actual meeting times.
 *   none            — nothing, worded identically to a `none` answer on every
 *                     other archetype so a refusal is not distinguishable from
 *                     an empty calendar.
 *
 * The intervals are dropped BEFORE the summary is rewritten, because
 * `summarizeAvailability` reads them — a clamp that rewrote the sentence and
 * left the arrays populated would disclose everything it claimed to withhold.
 *
 * Pure.
 */
export function clampAvailability(
  freeBusy: FreeBusy,
  ceiling: DisclosureRung,
  who: string,
): { summary: string; busy: BusyInterval[]; free: BusyInterval[] } {
  const hasFree = freeBusy.free.length > 0;

  switch (ceiling) {
    case 'full':
    case 'redacted':
      return { summary: summarizeAvailability(freeBusy, who), busy: freeBusy.busy, free: freeBusy.free };
    case 'summary':
      // The sentence carries a slot count and a duration but no instants, which
      // is the same trade `summary` makes elsewhere: magnitude, not content.
      return { summary: summarizeAvailability(freeBusy, who), busy: [], free: [] };
    case 'count':
      return {
        summary: hasFree
          ? `${who} have ${freeBusy.free.length} free slot${freeBusy.free.length === 1 ? '' : 's'} in that window.`
          : `${who} have no free time in that window.`,
        busy: [],
        free: [],
      };
    case 'boolean':
      return {
        summary: hasFree
          ? `${who} have some free time in that window.`
          : `${who} have no free time in that window.`,
        busy: [],
        free: [],
      };
    case 'none':
    default:
      return { summary: 'Nothing was shared.', busy: [], free: [] };
  }
}

/** Hard ceiling on rows an availability ask may load, whatever the window. */
const MAX_AVAILABILITY_EVENTS = 2000;

/** Longest window an availability ask may span (31 days). */
const MAX_AVAILABILITY_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

/**
 * Validate and bound an asker-supplied availability window. The wire schema
 * only guarantees the strings parse as ISO datetimes — it cannot express
 * ordering or a maximum span, so a peer could otherwise ask for "1970 to 2100"
 * and make the responder load and merge their entire calendar on demand.
 */
export function boundedWindow(fromIso: string, toIso: string): { from: Date; to: Date } {
  const from = new Date(fromIso);
  const to = new Date(toIso);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new BadRequestException('Invalid availability window');
  }

  if (to.getTime() <= from.getTime()) {
    throw new BadRequestException('Availability window must end after it starts');
  }

  if (to.getTime() - from.getTime() > MAX_AVAILABILITY_SPAN_MS) {
    throw new BadRequestException('Availability window is too long');
  }

  return { from, to };
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
