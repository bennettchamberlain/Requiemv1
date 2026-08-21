import { Field, GraphQLISODateTime, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

import { isGrantActive, type Ask, type AskAudit, type AskGrant, type AskQuery } from '@ci/domains/asks';

import { GlobalUID } from './GlobalUID';

export enum AskStatusEnum {
  sent = 'sent',
  delivered = 'delivered',
  under_review = 'under_review',
  answering = 'answering',
  answered = 'answered',
  declined = 'declined',
  expired = 'expired',
}
registerEnumType(AskStatusEnum, { name: 'AskStatus' });

export enum GrantModeEnum {
  auto = 'auto',
  review = 'review',
  block = 'block',
}
registerEnumType(GrantModeEnum, { name: 'GrantMode' });

export enum AskAuditOutcomeEnum {
  answered = 'answered',
  auto_answered = 'auto_answered',
  declined = 'declined',
  expired = 'expired',
}
registerEnumType(AskAuditOutcomeEnum, { name: 'AskAuditOutcome' });

/** The bounded, asker-supplied query carried by an ask. */
@ObjectType()
export class AskQueryType {
  @Field(() => String)
  queryType!: string;

  @Field(() => String, { nullable: true })
  dataClass!: string | null;

  @Field(() => String)
  prompt!: string;

  static toType(query: AskQuery): AskQueryType {
    return {
      queryType: query.queryType,
      dataClass: query.dataClass ?? null,
      prompt: query.prompt,
    };
  }
}

/** An interpersonal ask directed at another user's memory. */
@ObjectType()
export class AskType {
  @Field(() => ID)
  id!: string;

  /** Opaque user id of the asker. NULL for an inbound peer ask. */
  @Field(() => ID, { nullable: true })
  askerId!: string | null;

  /** The peer this ask came from (inbound) or was sent to (outbound). */
  @Field(() => String, { nullable: true })
  peerHandle!: string | null;

  /** 'local' | 'outbound' | 'inbound'. */
  @Field(() => String)
  direction!: string;

  /** Opaque user id of the responder (owner). */
  /** NULL for an OUTBOUND ask — the responder is the peer, not a local user. */
  @Field(() => ID, { nullable: true })
  responderId!: string | null;

  @Field(() => AskQueryType)
  query!: AskQueryType;

  /**
   * The ask's lifecycle state — FULL for the responder, collapsed for the
   * asker. See {@link askerVisibleStatus}.
   */
  @Field(() => AskStatusEnum)
  status!: AskStatusEnum;

  /**
   * The grant (or review) that authorized an answer, once decided.
   *
   * RESPONDER-ONLY. This is the id of one of the responder's own grant rows, and
   * handing it to the asker made `createAsk` a grant-matrix oracle: combined with
   * the returned decision it distinguishes auto from review from deny, at the
   * rate limit's 20 probes a minute, and on a block-grant auto-deny it separates
   * a standing block from a human refusal. The asker needs to know their ask was
   * accepted; they do not need the identifier of the rule that accepted it.
   */
  @Field(() => String, { nullable: true })
  consentBasis!: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  expiresAt!: Date | null;

  /**
   * `viewerUserId` decides whether the responder's private reasoning is
   * included. Callers that omit it get the safe projection — an omitted argument
   * must never be the disclosing case.
   */
  static toType(ask: Ask, viewerUserId?: string): AskType {
    const isResponder = viewerUserId != null && viewerUserId === ask.responderUserId;

    return {
      id: GlobalUID.encode('ask', ask.id),
      askerId: ask.askerUserId ? GlobalUID.encode('user', ask.askerUserId) : null,
      peerHandle: null,
      direction: ask.direction,
      responderId: ask.responderUserId ? GlobalUID.encode('user', ask.responderUserId) : null,
      query: AskQueryType.toType(ask.query),
      status: isResponder ? (ask.status as AskStatusEnum) : askerVisibleStatus(ask.status),
      consentBasis: isResponder ? ask.consentBasis : null,
      createdAt: ask.createdAt,
      updatedAt: ask.updatedAt,
      expiresAt: ask.expiresAt,
    };
  }
}

/**
 * What the ASKER is allowed to know about an ask's lifecycle: whether an answer
 * is waiting, and nothing else.
 *
 * ═══ THE ORACLE #2210 MOVED INSTEAD OF CLOSING ═══
 *
 * `CreateAskPayload.decision` was collapsed to the constant `ASK_ACCEPTED`
 * because the raw `auto` | `review` | `deny` told the asker the responder's
 * standing-grant posture. The SAME information stayed reachable on the same
 * payload through `ask.status`, one field along — and reproduced exactly that
 * way against Postgres: a block grant returned `status: 'declined'`, an auto
 * grant `'delivered'`, and no matching grant `'under_review'`. Three probes,
 * three distinguishable answers, bounded only by the rate limit.
 *
 * Masking it on `CreateAskPayload` alone would have moved it a second time: the
 * asker is a participant, so `ask(id)` and `askOutbox` hand them the same row
 * one round-trip later. The cut is therefore made HERE, in the projection that
 * already knows who is looking and already withholds `consentBasis` from the
 * asker for exactly this reason — one place, every read path.
 *
 * The collapse follows {@link ASK_ACCEPTED}'s own argument to its conclusion:
 *
 * - `declined` → `delivered`. Whether a block grant refused the ask, or the
 *   owner declined it after reading it, or the owner simply has not got to it,
 *   are indistinguishable to the asker. `SendPeerAskPayload` already makes this
 *   trade across a box boundary ("a declined result is deliberately
 *   indistinguishable from an unreachable peer"); this makes it inside one.
 * - `under_review` / `answering` → `delivered`. That an ask reached a human, or
 *   that the human approved it, is the responder's business until an answer
 *   exists.
 * - `expired` → `delivered`. The asker already holds `expiresAt` and can read
 *   their own clock, so the state adds nothing — and leaving it visible would
 *   restore the deny/expire contrast by another name.
 * - `answered` survives, because it is the one thing the asker legitimately
 *   needs: there is an answer, go and read it. A blocked ask never acquires
 *   one, which is the same shape as a responder who never got around to it.
 *
 * Pure.
 */
export function askerVisibleStatus(status: string): AskStatusEnum {
  return status === 'answered' ? AskStatusEnum.answered : AskStatusEnum.delivered;
}

/** A standing consent grant (the Grant Manager matrix). */
@ObjectType()
export class AskGrantType {
  @Field(() => ID)
  id!: string;

  /** Opaque user id of the grantee. NULL for a grant addressed to a peer. */
  @Field(() => ID, { nullable: true })
  granteeId!: string | null;

  /** Opaque id of the peer link this grant addresses, when it is a peer grant. */
  @Field(() => ID, { nullable: true })
  granteePeerLinkId!: string | null;

  @Field(() => String)
  queryType!: string;

  @Field(() => String, { nullable: true })
  dataClass!: string | null;

  @Field(() => GrantModeEnum)
  mode!: GrantModeEnum;

  @Field(() => String, { nullable: true })
  purpose!: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  revokedAt!: Date | null;

  /** Scheduled lapse — the Grant Manager's "Expires {date}". */
  @Field(() => GraphQLISODateTime, { nullable: true })
  expiresAt!: Date | null;

  /** 'revoked' | 'superseded'; set only alongside `revokedAt`. */
  @Field(() => String, { nullable: true })
  revocationReason!: string | null;

  /** 1 for an original grant, incremented by each change. */
  @Field(() => Int)
  version!: number;

  /** The grant this one replaced, when it was written by a change. */
  @Field(() => ID, { nullable: true })
  supersedesGrantId!: string | null;

  /**
   * Whether the grant is in force right now. Computed rather than stored: a
   * client that reasons from `revokedAt == null` alone silently treats a lapsed
   * grant as live, which is the whole reason `expiresAt` exists.
   */
  @Field(() => Boolean)
  active!: boolean;

  static toType(grant: AskGrant): AskGrantType {
    return {
      id: GlobalUID.encode('ask-grant', grant.id),
      granteeId: grant.granteeUserId ? GlobalUID.encode('user', grant.granteeUserId) : null,
      granteePeerLinkId: grant.granteePeerLinkId,
      queryType: grant.queryType,
      dataClass: grant.dataClass,
      mode: grant.mode as GrantModeEnum,
      purpose: grant.purpose,
      createdAt: grant.createdAt,
      updatedAt: grant.updatedAt,
      revokedAt: grant.revokedAt,
      expiresAt: grant.expiresAt,
      revocationReason: grant.revocationReason,
      version: grant.version,
      supersedesGrantId: grant.supersedesGrantId
        ? GlobalUID.encode('ask-grant', grant.supersedesGrantId)
        : null,
      active: isGrantActive(grant),
    };
  }
}

/** A disclosure-history entry (one terminal ask outcome). */
@ObjectType()
export class AskAuditType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID, { nullable: true })
  askId!: string | null;

  /** Opaque user id of the asker. NULL when a peer asked. */
  @Field(() => ID, { nullable: true })
  askerId!: string | null;

  /** The peer's handle at disclosure time, for an inbound federated ask. */
  @Field(() => String, { nullable: true })
  peerHandle!: string | null;

  /** NULL for an OUTBOUND ask — the responder is the peer, not a local user. */
  @Field(() => ID, { nullable: true })
  responderId!: string | null;

  @Field(() => AskQueryType)
  query!: AskQueryType;

  @Field(() => String, { nullable: true })
  consentBasis!: string | null;

  @Field(() => AskAuditOutcomeEnum)
  outcome!: AskAuditOutcomeEnum;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  static toType(audit: AskAudit): AskAuditType {
    return {
      id: GlobalUID.encode('ask-audit', audit.id),
      askId: audit.askId ? GlobalUID.encode('ask', audit.askId) : null,
      askerId: audit.askerUserId ? GlobalUID.encode('user', audit.askerUserId) : null,
      peerHandle: audit.peerHandle,
      responderId: audit.responderUserId ? GlobalUID.encode('user', audit.responderUserId) : null,
      query: AskQueryType.toType(audit.query),
      consentBasis: audit.consentBasis,
      outcome: audit.outcome as AskAuditOutcomeEnum,
      createdAt: audit.createdAt,
    };
  }
}
