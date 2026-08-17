import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import type { DescriptiveAnswer } from '@ci/domains/daily-metrics';

@ObjectType({ description: 'A catalog question the compute-then-narrate engine can answer' })
export class DescriptiveQuestionType {
  @Field(() => String)
  key!: string;

  @Field(() => String)
  category!: string;

  @Field(() => String)
  question!: string;

  @Field(() => String, { nullable: true, description: 'descriptive | predictive | correlational | anomaly | optimization' })
  analyticType?: string;
}

@ObjectType()
export class AnswerProvenanceType {
  @Field(() => String)
  metric!: string;

  @Field(() => [String!]!)
  sources!: string[];

  @Field(() => Int)
  daysWithData!: number;

  @Field(() => Int)
  coveragePct!: number;
}

@ObjectType({
  description: 'A grounded catalog answer. The number is computed; the sentence is phrasing only.',
})
export class DescriptiveAnswerType {
  @Field(() => String)
  key!: string;

  @Field(() => String)
  category!: string;

  @Field(() => String)
  question!: string;

  @Field(() => String)
  text!: string;

  @Field(() => Float, { nullable: true })
  value!: number | null;

  @Field(() => String, { nullable: true })
  unit?: string;

  @Field(() => String)
  timeframe!: string;

  @Field(() => AnswerProvenanceType)
  provenance!: AnswerProvenanceType;

  static toType(source: DescriptiveAnswer): DescriptiveAnswerType {
    return {
      key: source.key,
      category: source.category,
      question: source.question,
      text: source.text,
      value: source.value,
      unit: source.unit,
      timeframe: source.timeframe,
      provenance: {
        metric: source.provenance.metric,
        sources: [...source.provenance.sources],
        daysWithData: source.provenance.daysWithData,
        coveragePct: source.provenance.coveragePct,
      },
    };
  }
}
