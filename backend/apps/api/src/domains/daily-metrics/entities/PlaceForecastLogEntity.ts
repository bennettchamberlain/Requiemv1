import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** One {cluster, probability} entry of a logged prediction (stored as jsonb). */
export interface PlaceForecastLogPrediction {
  cluster_id: string;
  prob: number;
}

/**
 * Mirrors ci_derived.place_forecast_log (see the create migration). Every
 * predictNext output is persisted here so scoreLog can later fill in the
 * observed actual_cluster and compute hit-rate@k — the same
 * forecast-vs-actual scoring-loop shape as hbpe.prediction_score.
 */
@Entity({ schema: 'ci_derived', name: 'place_forecast_log' })
export class PlaceForecastLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'timestamptz', name: 'predicted_at' })
  predictedAt!: Date;

  @Column({ type: 'integer', name: 'horizon_hours' })
  horizonHours!: number;

  /** Top-k predictions, highest probability first. */
  @Column({ type: 'jsonb' })
  predictions!: PlaceForecastLogPrediction[];

  /**
   * The first cluster the user was observed staying at inside the horizon
   * window; NULL when the horizon elapsed with no observed stay.
   */
  @Column({ type: 'uuid', name: 'actual_cluster', nullable: true })
  actualCluster!: string | null;

  @Column({ type: 'boolean', default: false })
  scored!: boolean;
}
