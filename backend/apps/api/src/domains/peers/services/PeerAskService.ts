import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, IsNull, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import {
  type Ask,
  AskAnswerService,
  AskAuditService,
  AskEntity,
  AskExecutorService,
  AskService,
  applyDisclosureCeiling,
  assertAskTransition,
  buildDisclosedAnswer,
  disclosureCeiling,
  minRung,
  GrantService,
  type AskQuery,
  type DisclosedAnswer,
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
      // The basis comes off the transitioned row — `systemTransition` above
      // stamped it, so the audit cites exactly what the ask now records.
      await this.recordAudit(declined, link, 'declined', []);

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

    // ═══ THE PULL-SIDE CONSENT CHECK, WHICH THIS PATH DID NOT HAVE ═══
    //
    // Retroactive revocation protects the local path from two directions:
    // GrantService PUSHES a revoked grant's pre-authorized asks back into the
    // owner's inbox, and `AskService.complete` PULLS the current grant state
    // before it discloses anything. The federated path had neither — it went
    // straight from `evaluate` to disclosure — so the only thing standing
    // between a revoked grant and a peer was the `evaluate` read, and any
    // divergence between "no matching live grant" and "the deciding grant is
    // still in force" failed OPEN.
    //
    // Two ordering traps, both load-bearing:
    //   1. It runs AFTER `setConsentBasis`. `isConsentStanding` reads
    //      `ask.consentBasis` and returns true vacuously when it is null, so
    //      the pre-stamp ask would sail through the check that exists to stop
    //      it.
    //   2. It runs BEFORE `answerFor`. The local path re-checks at `complete`,
    //      i.e. after the executor has already read the owner's memory; here
    //      the check is in front of every read, so a withdrawn consent means
    //      the owner's data is never touched at all rather than read and then
    //      discarded.
    //
    // The ask lands where a revoked pre-authorization lands on the local path —
    // basis cleared, back in front of the owner — and the peer is told
    // `pending_review`, which is the same thing an unmatched ask is told. A
    // distinct "your grant was revoked" would hand the peer the owner's consent
    // posture as a side channel.
    if (!(await this.grantService.isConsentStanding(authorized))) {
      await this.askService.systemTransition(ask.id, 'under_review', { consentBasis: null });

      return { askId: body.askId, status: 'pending_review', reason: 'Awaiting owner review' };
    }

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
        // `id` is selected for the AUDIT, not for the answer — see the
        // backing-entity note below. `computeFreeBusy` ignores it, and no id
        // reaches the wire: the response carries interval boundaries only.
        select: { id: true, startTime: true, endTime: true, isAllDay: true },
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
      //
      // DISCLOSED vs BACKING, for an archetype that itemizes nothing:
      // `disclosedEntities` stays empty and that is correct — free/busy crosses
      // as interval boundaries, never as entity references, so there is nothing
      // the peer received to list. `backingEntities` is the half that was
      // missing: the box read N of the owner's calendar events to compute this
      // answer, and recording none of them left the owner's history unable to
      // say WHICH meetings a peer's "are you free?" consulted. The content path
      // has always recorded its candidate set here; availability now does the
      // same. Backing entities are owner-only and are never disclosed.
      await this.persistDisclosure(
        context,
        link,
        ask,
        {
          form: 'attribute',
          items: [],
          disclosedCount: answer.free.length,
          withheldCount: 0,
          summary: answer.summary,
          consentBasis,
        },
        [],
        events.map((event) => event.id),
      );

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

    // Same split the local path makes: `disclosed.items` is what actually
    // crossed to the peer (empty here — the peer protocol exposes no retrieval
    // archetype), while the match set is the owner's own record of what the
    // answer was computed over. Recording the matches as DISCLOSED made the
    // audit over-report every federated answer.
    await this.persistDisclosure(
      context,
      link,
      ask,
      disclosed,
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

  /**
   * Persist a federated disclosure ATOMICALLY: the answer row, the ask's
   * TERMINAL status, and the audit row.
   *
   * ═══ THE FEDERATED PATH NEVER TERMINALIZED ITS ASK ═══
   *
   * `answerFor` used to write an answer and an audit row and stop there, which
   * left a fully answered inbound peer ask sitting at `delivered` with its
   * consent basis intact — the exact shape of "auto-answerable, not yet
   * answered". Three consequences, all reproduced:
   *
   *   - the owner could `decline` an ask that had already been answered,
   *     writing a second, contradicting audit row for one disclosure;
   *   - `approve` moved it to `answering`, from which the only legal edge is
   *     `answered` — and `complete` would then hit the insert-only guard in
   *     `AskAnswerService.create` and raise a conflict forever. Wedged;
   *   - `withdrawPreAuthorization` selects exactly `status = 'delivered'` with
   *     this grant as the basis, so REVOKING THE GRANT REWROTE A DISCLOSURE
   *     THAT HAD ALREADY HAPPENED — status back to `under_review`, basis
   *     nulled — and the owner's history then disagreed with the audit log
   *     about whether anything was ever sent. `answered` is terminal and
   *     outside that filter, which is what closes it.
   *
   * ═══ AND IT WROTE THE TWO ROWS UN-TRANSACTED ═══
   *
   * The local path wraps them (`AskService.completeWithAnswer`); this one did
   * not. A failure between the answer insert and the audit insert leaves a
   * `ci.ask_answers` row describing a disclosure with no audit row saying it
   * happened — and it is PERMANENT, not transient: `AskAnswerService.create` is
   * insert-only, so the retry raises a conflict instead of writing the missing
   * audit. The owner's disclosure history is then silently short one entry,
   * forever.
   *
   * WHY NOT `AskService.completeWithAnswer`, which already does all of this?
   * Because the audit row it writes is built from the ask alone and cannot
   * carry `peerLinkId` / `peerHandle`, and a federated disclosure whose audit
   * row cannot name the peer it went to is a worse defect than the one being
   * fixed. The lifecycle rule itself is NOT duplicated here — the transitions
   * go through the same pure `assertAskTransition` state machine the local path
   * uses. Teaching `complete` to carry peer attribution (and then calling it
   * from here) is the follow-up; it lives in `domains/asks`.
   */
  private async persistDisclosure(
    context: UserServiceContext,
    link: PeerLink,
    ask: Ask,
    answer: DisclosedAnswer,
    disclosedEntities: string[],
    backingEntities: string[],
  ): Promise<void> {
    // The transaction is opened through an injected repository's `manager`
    // rather than an injected `DataSource`, exactly as `GrantService.supersede`
    // does. Which repository it is reached through is irrelevant — the manager
    // belongs to the connection, not to `EventEntity` — and going this way
    // keeps the constructor arity stable for the callers that build this
    // service by hand.
    await this.eventRepository.manager.transaction(async (manager) => {
      await this.answerService.create({ askId: ask.id, answer }, manager);
      const terminal = await this.terminalize(manager, context, ask);
      await this.recordAudit(terminal, link, 'auto_answered', disclosedEntities, backingEntities, manager);
    });
  }

  /**
   * Drive an auto-authorized inbound ask to `answered` inside the caller's
   * transaction.
   *
   * `delivered → answered` is not a legal edge, so this takes the same two
   * hops `AskService.complete` takes — `delivered → answering → answered` —
   * through the shared state machine rather than assigning the status
   * directly. Reading the row back inside the transaction (rather than trusting
   * the in-memory `ask` handed down from `handle`) is what makes the edge
   * assertion mean something: the row is the only thing that knows whether
   * something else moved this ask while the answer was being computed.
   *
   * Scoped by responder, matching `AskService.responderOwned` — an inbound peer
   * ask has no local asker, so the link owner is the only participant who can
   * own it.
   */
  private async terminalize(manager: EntityManager, context: UserServiceContext, ask: Ask): Promise<Ask> {
    const repository = manager.getRepository(AskEntity);
    const entity = await repository.findOne({
      where: { id: ask.id, responderUserId: context.userId },
    });

    if (entity == null) {
      throw new NotFoundException(`Ask ${ask.id} not found`);
    }

    if (entity.status === 'delivered') {
      entity.status = assertAskTransition(entity.status, 'answering');
    }

    entity.status = assertAskTransition(entity.status, 'answered');

    return AskEntity.toEgressType(await repository.save(entity));
  }

  private async recordAudit(
    ask: Ask,
    link: PeerLink,
    outcome: 'auto_answered' | 'declined',
    disclosedEntities: string[],
    backingEntities: string[] = [],
    manager?: EntityManager,
  ): Promise<void> {
    await this.auditService.record(
      {
        askId: ask.id,
        askerUserId: ask.askerUserId,
        peerLinkId: link.id,
        peerHandle: link.peerHandle,
        responderUserId: ask.responderUserId,
        query: ask.query,
        // Read off the ask rather than passed in: after `terminalize` the row
        // IS the record of what authorized this disclosure, and a separately
        // threaded copy could disagree with it.
        consentBasis: ask.consentBasis,
        outcome,
        disclosedEntities,
        backingEntities,
      },
      manager,
    );
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
