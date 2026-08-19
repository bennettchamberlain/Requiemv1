import { Field, Int, ObjectType } from '@nestjs/graphql';

import { AskAnswerType } from './AskAnswerType';
import { AskGrantType, AskType } from './AskType';
import { MutationPayload } from './MutationPayload';

@ObjectType()
export class CreateAskPayload extends MutationPayload {
  @Field(() => AskType, { nullable: true })
  ask?: AskType;

  /** The standing-grant decision applied on submit: `auto` | `review` | `deny`. */
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
