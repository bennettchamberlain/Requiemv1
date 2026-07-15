import { Field, GraphQLISODateTime, ID, ObjectType, registerEnumType } from '@nestjs/graphql';

import type { Ask, AskAudit, AskGrant, AskQuery } from '@ci/domains/asks';

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

  /** Opaque user id of the asker. */
  @Field(() => ID)
  askerId!: string;

  /** Opaque user id of the responder (owner). */
  @Field(() => ID)
  responderId!: string;

  @Field(() => AskQueryType)
  query!: AskQueryType;

  @Field(() => AskStatusEnum)
  status!: AskStatusEnum;

  /** The grant (or review) that authorized an answer, once decided. */
  @Field(() => String, { nullable: true })
  consentBasis!: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt!: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  expiresAt!: Date | null;

  static toType(ask: Ask): AskType {
    return {
      id: GlobalUID.encode('ask', ask.id),
      askerId: GlobalUID.encode('user', ask.askerUserId),
      responderId: GlobalUID.encode('user', ask.responderUserId),
      query: AskQueryType.toType(ask.query),
      status: ask.status as AskStatusEnum,
      consentBasis: ask.consentBasis,
      createdAt: ask.createdAt,
      updatedAt: ask.updatedAt,
      expiresAt: ask.expiresAt,
    };
  }
}

/** A standing consent grant (the Grant Manager matrix). */
@ObjectType()
export class AskGrantType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  granteeId!: string;

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

  @Field(() => GraphQLISODateTime, { nullable: true })
  revokedAt!: Date | null;

  static toType(grant: AskGrant): AskGrantType {
    return {
      id: GlobalUID.encode('ask-grant', grant.id),
      granteeId: GlobalUID.encode('user', grant.granteeUserId),
      queryType: grant.queryType,
      dataClass: grant.dataClass,
      mode: grant.mode as GrantModeEnum,
      purpose: grant.purpose,
      createdAt: grant.createdAt,
      revokedAt: grant.revokedAt,
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

  @Field(() => ID)
  askerId!: string;

  @Field(() => ID)
  responderId!: string;

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
      askerId: GlobalUID.encode('user', audit.askerUserId),
      responderId: GlobalUID.encode('user', audit.responderUserId),
      query: AskQueryType.toType(audit.query),
      consentBasis: audit.consentBasis,
      outcome: audit.outcome as AskAuditOutcomeEnum,
      createdAt: audit.createdAt,
    };
  }
}
