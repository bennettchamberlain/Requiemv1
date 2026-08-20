import { Field, GraphQLISODateTime, ID, InputType, Int } from '@nestjs/graphql';

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

  // NOTE: no `expiresAt` here yet. `CreateAskGrantDto` and `GrantService.create`
  // both accept one, but wiring it through means editing `createAskGrant`'s body
  // in AskResolver, which is being changed concurrently — a field the resolver
  // silently drops would be worse than no field. Set an expiry with
  // `updateAskGrant` until that one line lands.
}

/**
 * A change to an existing standing grant — the Grant Manager matrix's
 * `onChangeMode(grantId, mode)`.
 *
 * Every field is optional and an omitted one is INHERITED from the grant being
 * replaced, so a mode flip does not have to restate the whole grant. Note that
 * the grantee and the query type are absent by design: those identify which
 * grant this is, and changing them would make it a different grant, so the
 * caller creates one instead.
 *
 * Applied as a supersede — the old grant is closed out and a new row replaces
 * it. `GrantService.supersede` explains why.
 */
@InputType()
export class UpdateAskGrantInput {
  @Field(() => GrantModeEnum, { nullable: true })
  mode?: GrantModeEnum;

  @Field(() => String, { nullable: true })
  dataClass?: string;

  @Field(() => [String], { nullable: true })
  dataClasses?: string[];

  @Field(() => String, { nullable: true })
  purpose?: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  expiresAt?: Date;

  /**
   * Explicitly REMOVE the expiry, as distinct from leaving it alone. GraphQL
   * cannot tell an omitted nullable input field from one passed as null, so the
   * intent needs its own flag; without it, "make this grant permanent" is
   * inexpressible.
   */
  @Field(() => Boolean, { nullable: true })
  clearExpiry?: boolean;
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
