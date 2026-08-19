import { Field, Float, ID, ObjectType } from '@nestjs/graphql';
// import GraphQLJSONObject from 'graphql-type-json';

import { type Answer } from '@ci/domains/intelligence';

import { GlobalUID } from './GlobalUID';
import { Node } from './Node';

@ObjectType({ implements: () => [Node] })
export class AnswerType implements Node {
  __typename = AnswerType.name;

  __source!: Answer;

  @Field(() => ID)
  id!: string;

  @Field(() => String)
  answer!: string;

  /**
   * How sure the writer was, in [0,1]. Null means nothing ever scored this row:
   * the user typed it, it was imported, or it predates confidence capture.
   * Meaningful only alongside `answerSource` — a confidence on a user-authored
   * answer would be nonsense, and the UI reads the pair, never the number alone.
   */
  @Field(() => Float, { nullable: true })
  answerConfidence?: number | null;

  /** One line naming the evidence behind an inferred answer. Null otherwise. */
  @Field(() => String, { nullable: true })
  answerRationale?: string | null;

  @Field(() => String, { nullable: true })
  answerSource!: string;

  @Field(() => String)
  answerMethod!: string;

  @Field(() => Date)
  answeredAt!: Date;

  // @Field(() => GraphQLJSONObject)
  // sessionContext!: Record<string, unknown>;

  // @Field(() => String)
  // emotionalState!: string;

  // @Field(() => String)
  // locationContext!: string;
  //
  // @Field(() => [String])
  // extractedEntities!: string[];

  // @Field(() => Float)
  // sentimentScore!: number;
  //
  // @Field(() => Float)
  // complexityScore!: number;
  //
  // @Field(() => Boolean)
  // isSensitive!: boolean;

  // @Field(() => String)
  // sharingLevel!: string;

  static toType(answer: Answer): AnswerType {
    return {
      __typename: AnswerType.name,
      __source: answer,
      id: GlobalUID.encode('answer', answer.id),
      answer: answer.answer,
      answerConfidence: answer.answerConfidence ?? null,
      answerRationale: answer.answerRationale ?? null,
      answerSource: answer.answerSource,
      answerMethod: answer.answerMethod,
      answeredAt: answer.answeredAt,
      // sessionContext: answer.sessionContext,
      // emotionalState: answer.emotionalState,
      // locationContext: answer.locationContext,
      // extractedEntities: answer.extractedEntities,
      // sentimentScore: answer.sentimentScore,
      // complexityScore: answer.complexityScore,
      // isSensitive: answer.isSensitive,
      // sharingLevel: answer.sharingLevel,
    };
  }
}
