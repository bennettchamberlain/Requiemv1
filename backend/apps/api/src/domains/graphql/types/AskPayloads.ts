import { Field, Int, ObjectType } from '@nestjs/graphql';

import { AskAnswerType } from './AskAnswerType';
import { AskGrantType, AskType } from './AskType';
import { MutationPayload } from './MutationPayload';

/**
 * The only value {@link CreateAskPayload.decision} ever carries.
 *
 * It used to be the responder's raw standing-grant decision — `auto` | `review`
 * | `deny` — handed synchronously to the ASKER. That is the responder's consent
 * posture, not the asker's business, and returning it made `createAsk` a probe
 * against the grant matrix: submit an ask, read back whether a standing
 * pre-authorization, a review default, or a block covers it. Bounded only by
 * the rate limit, an asker could map the whole matrix by varying queryType and
 * dataClass — without ever receiving an answer.
 *
 * The honest signal the asker actually needs is that the ask was accepted for
 * handling, which is what this says. Every downgrade of that signal is
 * deliberate:
 *
 * - `auto` vs `review` is the existence of a standing grant. Collapsed.
 * - `deny` vs `review` is the existence of a BLOCK, which is the most sensitive
 *   cell in the matrix and the one an asker most wants to find. Collapsed —
 *   mirroring `SendPeerAskPayload`, where a decline is already deliberately
 *   indistinguishable from an unreachable peer.
 *
 * Nothing is lost that the asker could not learn honestly: an auto-answered ask
 * simply has an answer waiting when they read it, and a blocked one never
 * acquires one — the same shape as a responder who never got around to it.
 */
export const ASK_ACCEPTED = 'accepted';

@ObjectType()
export class CreateAskPayload extends MutationPayload {
  @Field(() => AskType, { nullable: true })
  ask?: AskType;

  /**
   * Acknowledgement only — always {@link ASK_ACCEPTED}. Deliberately NOT the
   * responder's `auto` | `review` | `deny` posture; see {@link ASK_ACCEPTED}.
   */
  @Field(() => String, { nullable: true })
  decision?: string;
}

@ObjectType()
export class AskPayload extends MutationPayload {
  @Field(() => AskType, { nullable: true })
  ask?: AskType;
}

@ObjectType()
export class RunAskPayload extends MutationPayload {
  @Field(() => AskType, { nullable: true })
  ask?: AskType;

  /** The disclosure-filtered answer produced for the ask (Phase 1). */
  @Field(() => AskAnswerType, { nullable: true })
  answer?: AskAnswerType;

  /** Convenience mirrors of the answer's counts. */
  @Field(() => Int, { nullable: true })
  disclosedCount?: number;

  @Field(() => Int, { nullable: true })
  withheldCount?: number;
}

@ObjectType()
export class AskGrantPayload extends MutationPayload {
  @Field(() => AskGrantType, { nullable: true })
  grant?: AskGrantType;
}

/**
 * Result of sending an outbound ask.
 *
 * `status` is the PEER's reply, normalized — `answered`, `pending_review` (they
 * queued it for a human), or `declined`. A declined result is deliberately
 * indistinguishable from an unreachable peer: the asker learns that no answer is
 * coming, not why.
 */
@ObjectType()
export class SendPeerAskPayload extends MutationPayload {
  @Field(() => AskType, { nullable: true })
  ask?: AskType;

  @Field(() => String, { nullable: true })
  status?: string;

  /** The disclosure-filtered answer, when the peer answered immediately. */
  @Field(() => AskAnswerType, { nullable: true })
  answer?: AskAnswerType;

  @Field(() => String, { nullable: true })
  reason?: string;
}
