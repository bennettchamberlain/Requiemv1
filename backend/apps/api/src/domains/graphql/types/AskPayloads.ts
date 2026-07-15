import { Field, ObjectType } from '@nestjs/graphql';

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
export class AskGrantPayload extends MutationPayload {
  @Field(() => AskGrantType, { nullable: true })
  grant?: AskGrantType;
}
