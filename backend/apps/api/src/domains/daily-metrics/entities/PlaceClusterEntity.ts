import { Column, Entity, type Point, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Mirrors ci_derived.place_clusters (see the create migration). A cluster is a
 * stable stay-point place mined from ci.position by PlaceClusterService.
 *
 * Reads that need scalar lat/lng go through raw SQL (ST_Y/ST_X in placeSql.ts)
 * rather than TypeORM spatial hydration, so the geography column here mostly
 * carries schema metadata; writes go through the deterministic upsert SQL.
 */
@Entity({ schema: 'ci_derived', name: 'place_clusters' })
export class PlaceClusterEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  centroid!: Point;

  /** Effective cluster extent in meters (max stay-to-centroid distance, floored at the merge radius). */
  @Column({ type: 'double precision', name: 'radius_m', default: 150 })
  radiusM!: number;

  /** Reverse-geocode place name from ci.geocode_cache; NULL when none is cached nearby. */
  @Column({ type: 'text', nullable: true })
  label!: string | null;

  @Column({ type: 'integer', name: 'visit_count', default: 0 })
  visitCount!: number;

  @Column({ type: 'timestamptz', name: 'first_seen', nullable: true })
  firstSeen!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_seen', nullable: true })
  lastSeen!: Date | null;
}
