import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Normalized identifier (email / phone / name) -> graph entity_id lookup.
 * Mirrors migration 20260624140000_create_entity_identifiers (kind CHECK
 * widened to include 'name' in 20260707120000_entity_identifiers_allow_name_kind,
 * contact-method columns added in 20260803211455_add_person_identity_and_merge).
 *
 * Populated on graph ingest from a Person entity's `properties.emails` /
 * `properties.phones` and queried by the people-linking backfill to resolve a
 * communication's raw participant strings to the entity they belong to.
 *
 * `valueNormalized` uses the SAME rule the importer applies: email = trim +
 * lowercase; phone = last 10 digits of the digit string. The composite
 * (owner_user_id, kind, value_normalized) is unique (the upsert key); there is
 * no surrogate PK, so the unique tuple stands in for one.
 */
@Entity({ schema: 'ci', name: 'entity_identifiers' })
export class EntityIdentifierEntity {
  @PrimaryColumn({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  @PrimaryColumn({ type: 'text' })
  kind!: 'email' | 'phone' | 'name';

  @PrimaryColumn({ name: 'value_normalized', type: 'text' })
  valueNormalized!: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  /** Original identifier as asserted by the source, pre-normalization. */
  @Column({ name: 'raw_value', type: 'text', nullable: true })
  rawValue!: string | null;

  /** User-facing contact-method label (work, home, mobile, ...). */
  @Column({ type: 'text', nullable: true })
  label!: string | null;

  /** Preferred contact method of this kind for the entity (service-enforced). */
  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary!: boolean;

  /** Provenance of the assertion (import:google, user, ...). */
  @Column({ type: 'text', nullable: true })
  source!: string | null;

  /** When the user explicitly confirmed the identifier. NULL = machine-asserted. */
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type EntityIdentifier = Readonly<EntityIdentifierEntity>;
