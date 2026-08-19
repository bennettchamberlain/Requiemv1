import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * Which `ci.entities` row a staged entity resolved to during the push. Mirrors
 * migration 20260810164304_create_ci_import_schema.
 *
 * Written from the ingest service's answer, so later edges in the same run can
 * reference a server entity without re-sending it — the push resolves each
 * person once, not once per message they appear in.
 *
 * Deliberately NO foreign key to `ci.entities`: entity resolution may merge two
 * people and retire an id, and a staging table must never be the thing that
 * blocks that. A mapping whose target has been retired is stale, not corrupt —
 * it dies with its run either way.
 */
@Entity({ schema: 'ci_import', name: 'entity_mappings' })
@Index('entity_mappings_server_idx', ['userId', 'serverEntityId'])
export class EntityMappingEntity {
  /**
   * The staged entity, and the primary key: a staged entity resolves to exactly
   * one server entity, so there is no surrogate id and no way to record the
   * same fact twice.
   */
  @PrimaryColumn({ type: 'uuid', name: 'staged_entity_id' })
  stagedEntityId!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  /** The `ci.entities` id — unenforced by design, see the class docblock. */
  @Column({ type: 'uuid', name: 'server_entity_id' })
  serverEntityId!: string;

  @Column({ type: 'timestamptz', name: 'synced_at', default: () => 'now()' })
  syncedAt!: Date;
}

export type EntityMapping = Readonly<EntityMappingEntity>;
