import { Field, GraphQLISODateTime, ID, Int, ObjectType, registerEnumType } from '@nestjs/graphql';

import type { AskAnswer, DisclosedItem } from '@ci/domains/asks';

import { GlobalUID } from './GlobalUID';

export enum AnswerFormEnum {
  boolean = 'boolean',
  existence = 'existence',
  attribute = 'attribute',
  retrieval = 'retrieval',
  identity = 'identity',
}
registerEnumType(AnswerFormEnum, { name: 'AnswerForm' });

export enum AnswerSourceEnum {
  self = 'self',
  peer = 'peer',
}
registerEnumType(AnswerSourceEnum, { name: 'AnswerSource' });

/** A disclosed entity reference — id + type only, never raw content. */
@ObjectType()
export class DisclosedItemType {
  @Field(() => String)
  id!: string;

  @Field(() => String)
  type!: string;

  static toType(item: DisclosedItem): DisclosedItemType {
    return { id: item.id, type: item.type };
  }
}

/**
 * The disclosure-filtered answer produced for an ask. Carries item references,
 * counts, form, and a templated summary — never raw node content or signed URLs.
 */
@ObjectType()
export class AskAnswerType {
  @Field(() => ID)
  id!: string;

  @Field(() => ID)
  askId!: string;

  @Field(() => AnswerFormEnum)
  form!: AnswerFormEnum;

  @Field(() => AnswerSourceEnum)
  answerSource!: AnswerSourceEnum;

  @Field(() => String, { nullable: true })
  summary!: string | null;

  /** Item references — populated for the `retrieval` form only. */
  @Field(() => [DisclosedItemType])
  items!: DisclosedItemType[];

  @Field(() => Int)
  disclosedCount!: number;

  /** Matched items the owner withheld ("deny all but X") — count only. */
  @Field(() => Int)
  withheldCount!: number;

  @Field(() => String, { nullable: true })
  consentBasis!: string | null;

  @Field(() => GraphQLISODateTime)
  createdAt!: Date;

  static toType(answer: AskAnswer): AskAnswerType {
    return {
      id: GlobalUID.encode('ask-answer', answer.id),
      askId: GlobalUID.encode('ask', answer.askId),
      form: answer.form as AnswerFormEnum,
      answerSource: answer.answerSource as AnswerSourceEnum,
      summary: answer.summary,
      items: answer.disclosedEntities.map(DisclosedItemType.toType),
      disclosedCount: answer.disclosedCount,
      withheldCount: answer.withheldCount,
      consentBasis: answer.consentBasis,
      createdAt: answer.createdAt,
    };
  }
}
