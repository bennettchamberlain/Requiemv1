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
