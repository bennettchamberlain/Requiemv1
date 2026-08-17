import { Field, ID, InputType } from '@nestjs/graphql';

import { GrantModeEnum } from './AskType';

/** The bounded, asker-supplied query. Phase 2 formalizes this as a DCQL subset. */
@InputType()
export class AskQueryInput {
  @Field(() => String)
  queryType!: string;

  @Field(() => String, { nullable: true })
  dataClass?: string;

  @Field(() => String)
  prompt!: string;
}

@InputType()
export class CreateAskInput {
  /** Opaque user id of the responder (owner) the ask is directed at. */
  @Field(() => ID)
  responderId!: string;

  @Field(() => AskQueryInput)
  query!: AskQueryInput;
}

@InputType()
export class CreateAskGrantInput {
  /** Opaque user id of the grantee who may ask. */
  @Field(() => ID)
  granteeId!: string;

  @Field(() => String)
  queryType!: string;

  @Field(() => String, { nullable: true })
  dataClass?: string;

  @Field(() => [String], { nullable: true })
  dataClasses?: string[];

  @Field(() => GrantModeEnum)
  mode!: GrantModeEnum;

  /** Optional DPV purpose URI (ECOSYSTEM.md Δ2). */
  @Field(() => String, { nullable: true })
  purpose?: string;
}
