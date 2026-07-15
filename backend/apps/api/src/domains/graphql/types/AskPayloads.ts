import { Field, Int, ObjectType } from '@nestjs/graphql';

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

  /**
   * Number of the responder's entities the ask matched (Phase 0 dogfood signal).
   * The disclosure-filtered answer that reaches the asker is Phase 1.
   */
  @Field(() => Int, { nullable: true })
  disclosedCount?: number;
}

@ObjectType()
export class AskGrantPayload extends MutationPayload {
  @Field(() => AskGrantType, { nullable: true })
  grant?: AskGrantType;
}
