import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Mirrors ci_derived.place_transitions (see the create migration). One row per
 * (user, from-cluster, to-cluster, hour, day-of-week) bucket; decayedCount is
 * the sum of 0.5^(age_days / 30) over every observed transition in the bucket,
 * so recent behavior dominates without old habits ever hitting exactly zero.
 */
@Entity({ schema: 'ci_derived', name: 'place_transitions' })
export class PlaceTransitionEntity {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @PrimaryColumn({ type: 'uuid', name: 'from_cluster' })
  fromCluster!: string;

  @PrimaryColumn({ type: 'uuid', name: 'to_cluster' })
  toCluster!: string;

  /** Hour (0-23) of the arrival at toCluster. */
  @PrimaryColumn({ type: 'integer', name: 'hour_bucket' })
  hourBucket!: number;

  /** Day of week (0-6, Sunday = 0) of the arrival at toCluster. */
  @PrimaryColumn({ type: 'integer' })
  dow!: number;

  @Column({ type: 'double precision', name: 'decayed_count', default: 0 })
  decayedCount!: number;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
