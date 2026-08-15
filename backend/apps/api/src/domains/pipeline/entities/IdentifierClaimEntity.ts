import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * `ci.identifier_claims` — the evidence behind every person link.
 *
 * Mirrors migration `20260809183010_identifier_claims`, which is the source of
 * truth (CLAUDE.md: the SQL is hand-written, the entity is updated to match).
 *
 * ── Why a claim exists at all ──────────────────────────────────────────────
 *
 * A person link is stored today as a bare uuid — `ci.communications
 * .from_entity_id`, `.to_entity_ids`, `ci.events.organizer_entity_id`,
 * `.participant_entity_ids`. Those columns record an answer and nothing about
 * how it was reached, so a wrong match can only be overwritten (destroying the
 * observation that caused it), a LOSING claim is silently discarded by
 * `ci.entity_identifiers`' `ON CONFLICT DO NOTHING`, and an identifier that
 * resolved to nobody leaves no trace whatsoever.
 *
 * This table holds the observation. **The link columns are a PROJECTION of
 * these rows**, which is what makes a mistake correctable: reject a claim and
 * the projection changes, while the fact that `dana@example.com` appeared in
 * that message's `to` header survives.
 *
 * ── Nothing here merges anything ───────────────────────────────────────────
 *
 * Two entities claiming one identifier is a merge CANDIDATE, never a merge.
 * `enrich.person_link` writes claims and projects links; it never collapses two
 * person rows. CLEAN proposes, a human disposes — {@link disposition} is the
 * only column a human writes and the only one no stage ever does.
 *
 * NOT a control-plane table, despite living beside the five that are: it holds
 * user data (hence the FK to `ci.users`, which `ci.pipeline_state` deliberately
 * lacks) and it is read by the graph, not by the dispatcher. It lives here
 * because `enrich.person_link` is its only writer.
 */
@Entity({ schema: 'ci', name: 'identifier_claims' })
@Index('identifier_claims_lookup_idx', ['ownerUserId', 'kind', 'valueNormalized'])
export class IdentifierClaimEntity {
  /**
   * `@PrimaryColumn`, NOT `@PrimaryGeneratedColumn('uuid')`, matching the other
   * entities in this folder: the id comes from the column default
   * `ci.gen_uuid_v7()`, so rows sort by insertion time. TypeORM's generated-uuid
   * strategy would mint a v4 client-side and throw that ordering away.
   */
  @PrimaryColumn({ name: 'claim_id', type: 'uuid' })
  claimId!: string;

  @Column({ name: 'owner_user_id', type: 'uuid' })
  ownerUserId!: string;

  /**
   * Where the identifier was observed. Shares
   * `ci.pipeline_state.entity_type`'s vocabulary on purpose (`communication`,
   * `event`) so a claim and the ledger row that produced it join without a
   * translation table. `person` is an entity asserting its own identifier —
   * the shape the duplicate-detection GROUP BY reads.
   */
  @Column({ name: 'subject_type', type: 'text' })
  subjectType!: string;

  @Column({ name: 'subject_id', type: 'uuid' })
  subjectId!: string;

  /**
   * Slot on the subject row: `from` | `to` | `cc` | `bcc` | `organizer` |
   * `participant` | `self`. Part of the unique key, because a calendar
   * organizer is routinely also an attendee and collapsing the two would lose
   * the fact that makes `organizer_entity_id` projectable.
   */
  @Column({ type: 'text' })
  role!: string;

  /** `email` | `phone` | `handle` | `name`. CHECKed in the migration. */
  @Column({ type: 'text' })
  kind!: 'email' | 'phone' | 'handle' | 'name';

  /**
   * The SHARED join key — byte-identical to
   * `ci.entity_identifiers.value_normalized` and to what `classifyParticipant`
   * computes at every lookup, here and in CI-Import-Tools. Redefining it would
   * break people-linking in both repos with no error anywhere.
   */
  @Column({ name: 'value_normalized', type: 'text' })
  valueNormalized!: string;

  /**
   * Strict international phone form, when the raw value STATED a country. NULL
   * otherwise — never guessed.
   *
   * The phone widening. `normalizePhone` keeps the last ten digits, so UK
   * `+44 20 7946 0958` and US `(207) 946-0958` collapse to one identity; two
   * claims agreeing on {@link valueNormalized} and disagreeing here are
   * provably different numbers, and the stage refuses that match with
   * `method = 'phone_country_conflict'`.
   */
  @Column({ name: 'value_e164', type: 'text', nullable: true })
  valueE164!: string | null;

  /** What the source actually said, when it differs from the normalized form. */
  @Column({ name: 'raw_value', type: 'text', nullable: true })
  rawValue!: string | null;

  /**
   * The person this resolved to, or NULL when it resolved to nobody.
   *
   * A NULL row is not a failure — it is the observation that makes an
   * unlinkable participant countable. "5,208 addresses in your corpus belong to
   * no contact" is a number the appliance could not previously produce.
   */
  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId!: string | null;

  /**
   * Confidence in `(0, 1]`, NULL exactly when unresolved (a CHECK enforces the
   * iff). Graded by {@link method} and never fabricated.
   */
  @Column({ type: 'real', nullable: true })
  confidence!: number | null;

  /**
   * How the match was made: `email_exact`, `phone_e164`, `phone_last10`,
   * `handle_exact`, `name_exact`. What makes {@link confidence} auditable
   * rather than a bare float.
   */
  @Column({ type: 'text', nullable: true })
  method!: string | null;

  /** Pipeline stage id that wrote the row, e.g. `enrich.person_link`. */
  @Column({ type: 'text', nullable: true })
  stage!: string | null;

  /** Looser provenance, the vocabulary `ci.entity_identifiers.source` uses. */
  @Column({ type: 'text', nullable: true })
  source!: string | null;

  /**
   * Normalisation + matching rule generation behind the resolution. `0` means
   * the row predates spec versioning, so it is below every live spec and
   * re-qualifies for recompute — the same load-bearing zero as
   * `ci.pipeline_state.stage_version`.
   */
  @Column({ name: 'spec_version', type: 'int' })
  specVersion!: number;

  /**
   * A HUMAN's verdict. NULL = proposed. A `rejected` claim keeps its row and is
   * excluded from the projection, so the rejection survives the next sweep
   * instead of being silently re-derived.
   */
  @Column({ type: 'text', nullable: true })
  disposition!: 'confirmed' | 'rejected' | null;

  /** When the human decided. Non-NULL exactly when {@link disposition} is. */
  @Column({ name: 'disposed_at', type: 'timestamptz', nullable: true })
  disposedAt!: Date | null;

  /** Refreshed on every re-observation of the same (subject, role, identifier). */
  @Column({ name: 'observed_at', type: 'timestamptz' })
  observedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

export type IdentifierClaim = Readonly<IdentifierClaimEntity>;
