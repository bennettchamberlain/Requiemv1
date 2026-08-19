import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import type { CalibrationReport, CalibrationScore } from '@ci/domains/predictions';

@ObjectType()
export class CalibrationScoreType {
  @Field(() => String)
  scoredAt!: string;

  @Field(() => Float, { nullable: true })
  brier!: number | null;

  @Field(() => Float, { nullable: true })
  l0Top1Acc!: number | null;

  @Field(() => Float, { nullable: true })
  l1Top3Acc!: number | null;

  @Field(() => Float, { nullable: true })
  ece!: number | null;

  @Field(() => Float, { nullable: true })
  coverage!: number | null;

  @Field(() => Boolean)
  driftFlag!: boolean;

  @Field(() => Int, { nullable: true })
  nBuckets!: number | null;

  @Field(() => String, { nullable: true, description: 'hmt / b0 / b1 / b2' })
  modelVersion!: string | null;
}

@ObjectType({
  description: 'Forecast self-consistency against Qwen-derived behavior labels — not ground-truth accuracy.',
})
export class PredictionCalibrationType {
  @Field(() => String)
  basis!: string;

  @Field(() => CalibrationScoreType, { nullable: true })
  latest!: CalibrationScoreType | null;

  @Field(() => [CalibrationScoreType!]!)
  history!: CalibrationScoreType[];

  static toType(source: CalibrationReport): PredictionCalibrationType {
    return {
      basis: source.basis,
      latest: source.latest ? toScore(source.latest) : null,
      history: source.history.map(toScore),
    };
  }
}

function toScore(source: CalibrationScore): CalibrationScoreType {
  return { ...source };
}
