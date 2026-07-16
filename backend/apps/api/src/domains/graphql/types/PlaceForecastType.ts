import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import type { PlaceForecast } from '@ci/domains/insights';

@ObjectType({ description: 'One candidate next place with its probability' })
export class PlacePredictionType {
  @Field(() => String, { description: 'ci_derived.place_clusters id' })
  clusterId!: string;

  @Field(() => String, { nullable: true, description: 'Reverse-geocoded place name, when cached' })
  label!: string | null;

  @Field(() => Float)
  lat!: number;

  @Field(() => Float)
  lng!: number;

  @Field(() => Float, { description: 'Probability in [0, 1]; the top-k sums to <= 1' })
  probability!: number;
}

@ObjectType({ description: 'One coarse heat-grid cell (~1 km) weighted by predicted probability' })
export class PlaceHeatCellType {
  @Field(() => Float)
  lat!: number;

  @Field(() => Float)
  lng!: number;

  @Field(() => Float)
  weight!: number;
}

@ObjectType({ description: 'Top-k next-place forecast from the place transition model' })
export class PlaceForecastType {
  @Field(() => String, { description: 'OK, or NO_HISTORY when no place clusters exist yet' })
  status!: string;

  @Field(() => String, { description: 'ISO-8601 timestamp the prediction was made at' })
  predictedAt!: string;

  @Field(() => Int)
  horizonHours!: number;

  @Field(() => Int)
  k!: number;

  @Field(() => String, {
    nullable: true,
    description:
      'Which backoff level produced the distribution (FROM_HOUR_DOW, FROM_HOUR_ADJACENT, FROM_ANY, GLOBAL_PRIOR)',
  })
  backoffLevel!: string | null;

  @Field(() => [PlacePredictionType!]!)
  predictions!: PlacePredictionType[];

  @Field(() => [PlaceHeatCellType!]!)
  heatGrid!: PlaceHeatCellType[];

  static toType(source: PlaceForecast): PlaceForecastType {
    return {
      status: source.status,
      predictedAt: source.predictedAt.toISOString(),
      horizonHours: source.horizonHours,
      k: source.k,
      backoffLevel: source.backoffLevel,
      predictions: source.predictions.map((prediction) => ({ ...prediction })),
      heatGrid: source.heatGrid.map((cell) => ({ ...cell })),
    };
  }
}
