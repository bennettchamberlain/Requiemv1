import { Field, ID, InputType, Int } from '@nestjs/graphql';

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

/**
 * An outbound ask to a peer Companion.
 *
 * The archetype union is flattened for GraphQL (which has no input unions);
 * `OutboundAskService` narrows it back to the discriminated protocol shape, and
 * fields that do not belong to the chosen archetype are ignored rather than
 * silently widening the request.
 */
@InputType()
export class SendPeerAskInput {
  /** Portal handle of the linked peer to ask. */
  @Field(() => String)
  handle!: string;

  @Field(() => String)
  prompt!: string;

  /** One of: relationship | content | availability. */
  @Field(() => String)
  archetype!: string;

  /** relationship/content: who or what is being asked about. */
  @Field(() => String, { nullable: true })
  subject?: string;

  /** content: coarse data class, e.g. photos. */
  @Field(() => String, { nullable: true })
  dataClass?: string;

  /** availability (required) and content (optional): ISO window. */
  @Field(() => String, { nullable: true })
  from?: string;

  @Field(() => String, { nullable: true })
  to?: string;

  /** availability: minimum contiguous free minutes worth reporting. */
  @Field(() => Int, { nullable: true })
  minMinutes?: number;

  /** Shown to the responder for context; never used to widen scope. */
  @Field(() => String, { nullable: true })
  purpose?: string;

  /**
   * Portal-issued access token whose audience is the PEER box. Supplied by the
   * caller until Portal token exchange lands; this box never mints or stores it.
   */
  @Field(() => String)
  peerAccessToken!: string;
}
