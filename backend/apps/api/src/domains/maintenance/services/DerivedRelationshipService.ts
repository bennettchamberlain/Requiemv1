import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';
import { RelationshipType } from '@ci/domains/graph';
import { GraphDeltaWriter } from '@ci/domains/memory';

/**
 * How many separate days at a place make it one the owner FREQUENTS.
 *
 * Days rather than visits: `ci.position` is the only repeat-visit signal the
 * schema carries, and it counts GPS fixes, not arrivals.
 */
const FREQUENTS_MIN_VISIT_DAYS = 3;

/**
 * Per-call switches for {@link DerivedRelationshipService.derive}.
 *
 * The split exists because the three legs are not the same KIND of write. Two
 * of them project an aggregate of edges the user's own data already asserts
 * (people who demonstrably emailed each other; a place visited three times).
 * The third MINTS A NEW ENTITY — a `Group` nobody's data names — which is a
 * claim about the user's life rather than a summary of it, and therefore
 * something the Autonomy trust dial has to be asked about first.
 */
export interface DerivedRelationshipOptions {
  /**
   * Reify household `Group` entities from LIVES_WITH + shared LIVES_IN clusters.
   *
   * Defaults to TRUE, which keeps every pre-existing caller (POST
   * /api/maintenance/derive-relationships, the orchestrator's
   * `derive_relationships` leg driven by an operator over HTTP/CLI) behaving
   * exactly as before: a human asked for the whole stage.
   *
   * The scheduled caller passes FALSE unless
   * `PersonalizationService.decideAction({ kind: 'graph_entity' })` returned
   * `auto` — see `DerivationRunListener`. A timer is not a human, and
   * `graph_entity` is in `GRAPH_CONNECTION_KINDS`, so only `hands_off` ever
   * auto-applies it.
   */
  reifyHouseholdGroups?: boolean;
}

export interface DerivedRelationshipResult {
  communicatesWith: number;
  frequents: number;
  groupsReified: number;
  /**
   * Why `groupsReified` is what it is. `withheld` means the leg was not run at
   * all — a zero that says "not permitted" instead of "nothing to do", which is
   * the difference between a signal and a silence on the Jobs dashboard.
   */
  householdReification: 'applied' | 'withheld';
}

/**
 * #1947 stages C–D — L2 aggregates and derived Groups.
 *
 * Aggregates upsert strength-weighted edges from episodic history; Groups are
 * reified from indicator clusters with provenance for the interview loop.
 * Idempotent: re-running converges on the directed unique index.
 */
@Injectable()
export class DerivedRelationshipService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly graphDeltaWriter: GraphDeltaWriter,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(DerivedRelationshipService.name);
  }

  async derive(userId: string, options: DerivedRelationshipOptions = {}): Promise<DerivedRelationshipResult> {
    const reifyHouseholds = options.reifyHouseholdGroups !== false;
    const communicatesWith = await this.upsertCommunicatesWith(userId);
    const frequents = await this.upsertFrequents(userId);
    const groupsReified = reifyHouseholds ? await this.reifyHouseholdGroups(userId) : 0;

    this.logger.log('Derived relationship pass complete', {
      userId,
      communicatesWith,
      frequents,
      groupsReified,
      householdReification: reifyHouseholds ? 'applied' : 'withheld',
    });

    return {
      communicatesWith,
      frequents,
      groupsReified,
      householdReification: reifyHouseholds ? 'applied' : 'withheld',
    };
  }

  /**
   * COMMUNICATES_WITH from episodic EMAILED / MESSAGED / CALLED / MET_WITH /
   * ORGANIZED_EVENT_WITH person↔person edges.
   *
   * ### What `n` is, and what it is NOT
   *
   * It is NOT a communication count, and no wording here should imply one. The
   * same schema fact that made the FREQUENTS leg a no-op applies to this one:
   * `relationships_unique_directed_idx` is UNIQUE on
   * (from_entity_id, to_entity_id, relationship_type) WHERE `is_active`, so a
   * pair holds at most ONE active row per direction per type. Aggregating those
   * rows therefore counts DISTINCT (direction, type) combinations — bounded at
   * 10 for the five types above — however many emails, messages or calls
   * actually passed between the two people. Two colleagues who exchanged 4,000
   * emails and one who sent a single text both count 1.
   *
   * Which is why the property is named `episodic_link_kinds`. The strength that
   * comes off it, `LEAST(1, LN(n+1)/LN(10)/2)`, is likewise a function of that
   * count and saturates at `LN(11)/LN(10)/2 ≈ 0.52` — a real ceiling, not a
   * theoretical one, and the honest reading of the edge is "these two are
   * linked in n distinct ways", not "these two talk a lot".
   *
   * The leg still does useful work: it projects one bidirectional L2 edge per
   * pair the user's own data already links, which is what the graph reads. It
   * is the WEIGHT that is weaker than it looks.
   *
   * ### The follow-up this does not take
   *
   * A true frequency would have to come from the evidence, the way
   * {@link DerivedRelationshipService.upsertFrequents} now takes its day count
   * from `ci.position` — here that means counting `ci.communications` rows
   * naming both people (`from_entity_id` / `to_entity_ids`). That changes every
   * existing edge's strength for every user, so it is deliberately NOT bundled
   * into a fix pass; `ON CONFLICT DO NOTHING` means it would also need a
   * re-derive to take effect on rows that already exist.
   */
  private async upsertCommunicatesWith(userId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      // Historical rows sometimes store entity types in lowercase ('person');
      // match case-insensitively and always write canonical 'Person'.
      const inserted: Array<{
        relationship_id: string;
        from_entity_id: string;
        to_entity_id: string;
      }> = await manager.query(
        `WITH episodic AS (
           SELECT
             LEAST(from_entity_id, to_entity_id) AS a,
             GREATEST(from_entity_id, to_entity_id) AS b,
             -- Distinct (direction, type) rows, NOT episodes: the unique index
             -- caps this at 10. See the method comment.
             COUNT(*)::int AS n
           FROM ci.relationships
          WHERE owner_user_id = $1
            AND is_active = TRUE
            AND relationship_type = ANY($2::text[])
            AND lower(from_entity_type) = 'person'
            AND lower(to_entity_type) = 'person'
            AND from_entity_id <> to_entity_id
          GROUP BY 1, 2
         )
         INSERT INTO ci.relationships
           (from_entity_id, to_entity_id, relationship_type, strength, properties,
            owner_user_id, from_entity_type, to_entity_type, is_bidirectional)
         SELECT a, b, $3,
                LEAST(1.0, LN(n + 1) / LN(10) / 2.0),
                jsonb_build_object(
                  'layer', 'L2',
                  'provenance', jsonb_build_object('source', 'DerivedRelationshipService', 'job', 'communicates_with'),
                  'episodic_link_kinds', n
                ),
                $1, 'Person', 'Person', TRUE
           FROM episodic
         ON CONFLICT DO NOTHING
         RETURNING relationship_id, from_entity_id, to_entity_id`,
        [
          userId,
          ['EMAILED', 'MESSAGED', 'CALLED', 'MET_WITH', 'ORGANIZED_EVENT_WITH'],
          RelationshipType.COMMUNICATES_WITH,
        ],
      );

      await this.recordCreated(manager, userId, RelationshipType.COMMUNICATES_WITH, inserted);

      return inserted.length;
    });
  }

  /**
   * FREQUENTS for places the owner visited on ≥ {@link FREQUENTS_MIN_VISIT_DAYS}
   * separate days (strength by day count).
   *
   * A repeat visit is NOT countable from `ci.relationships`:
   * `relationships_unique_directed_idx` is UNIQUE on (from, to, type) WHERE
   * is_active, so a person→place pair holds at most ONE active VISITED row no
   * matter how many times the place was visited. Counting those rows is always
   * `1`, which is what made this leg a nightly no-op.
   *
   * The count comes from the evidence the edge was projected from instead:
   * `ci.position` rows whose `location_entity_id` snapped to the place (the
   * `position.visited` rule in the deterministic-edge matrix). Distinct days,
   * not fixes — telemetry emits fixes by the minute, so a row count would call
   * a single afternoon a habit.
   *
   * The VISITED edge is still the gate: FREQUENTS only ever strengthens a
   * place the graph already asserts the owner goes to, and the per-place
   * LATERAL keeps the position scan on `position_entity_idx` rather than
   * grouping the whole hypertable. Day boundaries are UTC because
   * `ci.users.timezone` is unvalidated free text and one bad value there would
   * fault the entire nightly pass.
   */
  private async upsertFrequents(userId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const inserted: Array<{
        relationship_id: string;
        from_entity_id: string;
        to_entity_id: string;
      }> = await manager.query(
        // Every VISITED edge starts at the owner's own Person entity
        // (ci.users.entity_id) — both producers, the position projection and
        // KnownPlacesService, anchor it there — and ci.position holds only the
        // owner's telemetry, so the join is what keeps a count of the owner's
        // fixes from being attributed to somebody else's visits.
        `WITH visited AS (
           SELECT r.from_entity_id, r.to_entity_id, r.from_entity_type, r.to_entity_type
             FROM ci.relationships r
             JOIN ci.users u ON u.entity_id = r.from_entity_id AND u.id = $1
            WHERE r.owner_user_id = $1
              AND r.is_active = TRUE
              AND r.relationship_type = 'VISITED'
         ),
         visits AS (
           SELECT v.from_entity_id, v.to_entity_id, v.from_entity_type, v.to_entity_type, d.days AS n
             FROM visited v
             CROSS JOIN LATERAL (
               SELECT COUNT(DISTINCT (p.time AT TIME ZONE 'UTC')::date)::int AS days
                 FROM ci.position p
                WHERE p.user_id = $1
                  AND p.location_entity_id = v.to_entity_id
             ) d
            WHERE d.days >= $3
         )
         INSERT INTO ci.relationships
           (from_entity_id, to_entity_id, relationship_type, strength, properties,
            owner_user_id, from_entity_type, to_entity_type, is_bidirectional)
         SELECT from_entity_id, to_entity_id, $2,
                LEAST(1.0, LN(n + 1) / LN(10) / 2.0),
                jsonb_build_object(
                  'layer', 'L2',
                  'context', 'unknown',
                  'provenance', jsonb_build_object(
                    'source', 'DerivedRelationshipService',
                    'job', 'frequents',
                    'derived_from', 'position.location_entity_id'
                  ),
                  'visit_days', n
                ),
                $1, from_entity_type, to_entity_type, FALSE
           FROM visits
         ON CONFLICT DO NOTHING
         RETURNING relationship_id, from_entity_id, to_entity_id`,
        [userId, RelationshipType.FREQUENTS, FREQUENTS_MIN_VISIT_DAYS],
      );

      await this.recordCreated(manager, userId, RelationshipType.FREQUENTS, inserted);

      return inserted.length;
    });
  }

  /**
   * Household Groups from shared LIVES_IN + LIVES_WITH clusters.
   * Creates a Group entity (`group_kind: household`) and MEMBER_OF edges.
   */
  private async reifyHouseholdGroups(userId: string): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      // Pairwise people who LIVES_WITH each other and share a LIVES_IN place.
      const clusters: Array<{ place_id: string; person_ids: string[] }> = await manager.query(
        `WITH cohabit AS (
           SELECT DISTINCT
             LEAST(r.from_entity_id, r.to_entity_id) AS a,
             GREATEST(r.from_entity_id, r.to_entity_id) AS b
           FROM ci.relationships r
          WHERE r.owner_user_id = $1
            AND r.is_active = TRUE
            AND r.relationship_type = 'LIVES_WITH'
         ),
         homes AS (
           SELECT from_entity_id AS person_id, to_entity_id AS place_id
             FROM ci.relationships
            WHERE owner_user_id = $1
              AND is_active = TRUE
              AND relationship_type = 'LIVES_IN'
         )
         SELECT h1.place_id,
                ARRAY_AGG(DISTINCT x.person_id ORDER BY x.person_id) AS person_ids
           FROM cohabit c
           JOIN homes h1 ON h1.person_id = c.a
           JOIN homes h2 ON h2.person_id = c.b AND h2.place_id = h1.place_id
           CROSS JOIN LATERAL (VALUES (c.a), (c.b)) AS x(person_id)
          GROUP BY h1.place_id
         HAVING COUNT(DISTINCT x.person_id) >= 2`,
        [userId],
      );

      let created = 0;

      for (const cluster of clusters) {
        // Stable linked_id = place uuid (entities.linked_id is uuid, not text).
        const existing: Array<{ entity_id: string }> = await manager.query(
          `SELECT entity_id FROM ci.entities
            WHERE owner_user_id = $1 AND entity_type = 'Group'
              AND linked_table = 'derived_household' AND linked_id = $2::uuid
            LIMIT 1`,
          [userId, cluster.place_id],
        );

        let groupId = existing[0]?.entity_id;

        if (!groupId) {
          const inserted: Array<{ entity_id: string }> = await manager.query(
            `INSERT INTO ci.entities
               (entity_id, entity_type, name, owner_user_id, is_active, linked_table, linked_id, properties)
             VALUES (gen_random_uuid(), 'Group', $3, $1, TRUE, 'derived_household', $2::uuid,
                     jsonb_build_object(
                       'group_kind', 'household',
                       'layer', 'L2',
                       'strength', 0.6,
                       'provenance', jsonb_build_object('source', 'DerivedRelationshipService', 'place_id', $2)
                     ))
             RETURNING entity_id`,
            [userId, cluster.place_id, 'Household'],
          );
          groupId = inserted[0].entity_id;
          created += 1;

          // Group −LOCATED_AT→ Place
          await manager.query(
            `INSERT INTO ci.relationships
               (from_entity_id, to_entity_id, relationship_type, strength, properties,
                owner_user_id, from_entity_type, to_entity_type, is_bidirectional)
             VALUES ($1, $2, 'LOCATED_AT', 0.8,
                     jsonb_build_object('layer', 'L2', 'provenance', jsonb_build_object('source', 'DerivedRelationshipService')),
                     $3, 'Group', 'Location', FALSE)
             ON CONFLICT DO NOTHING`,
            [groupId, cluster.place_id, userId],
          );
        }

        for (const personId of cluster.person_ids) {
          await manager.query(
            `INSERT INTO ci.relationships
               (from_entity_id, to_entity_id, relationship_type, strength, properties,
                owner_user_id, from_entity_type, to_entity_type, is_bidirectional)
             VALUES ($1, $2, 'MEMBER_OF', 0.7,
                     jsonb_build_object('role', 'resident', 'layer', 'L2',
                       'provenance', jsonb_build_object('source', 'DerivedRelationshipService', 'confirmed_by', null)),
                     $3, 'Person', 'Group', FALSE)
             ON CONFLICT DO NOTHING`,
            [personId, groupId, userId],
          );
        }
      }

      return created;
    });
  }

  private async recordCreated(
    manager: Parameters<GraphDeltaWriter['recordMany']>[1],
    userId: string,
    relationshipType: string,
    inserted: Array<{ relationship_id: string; from_entity_id: string; to_entity_id: string }>,
  ): Promise<void> {
    if (inserted.length === 0) {
      return;
    }

    await this.graphDeltaWriter.recordMany(
      inserted.map((row) => ({
        nodeType: 'relationship' as const,
        changeType: 'created' as const,
        relationshipId: row.relationship_id,
        relationshipType,
        fromEntityId: row.from_entity_id,
        toEntityId: row.to_entity_id,
        ownerUserId: userId,
        changeSource: 'DerivedRelationshipService',
        changeReason: relationshipType,
      })),
      manager,
    );
  }
}
