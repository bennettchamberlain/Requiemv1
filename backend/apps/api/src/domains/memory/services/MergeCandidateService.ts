import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { type Person, PersonEntity } from '../entities/PersonEntity';

/** The three states `ci.merge_candidates.status` is CHECK-constrained to. */
export type MergeCandidateStatus = 'pending' | 'accepted' | 'rejected';

export const MERGE_CANDIDATE_STATUSES: readonly MergeCandidateStatus[] = ['pending', 'accepted', 'rejected'];

export function isMergeCandidateStatus(value: string): value is MergeCandidateStatus {
  return (MERGE_CANDIDATE_STATUSES as readonly string[]).includes(value);
}

/** One shared claim behind a proposal, as written by the detector. */
export interface MergeCandidateEvidence {
  kind: string;
  value: string;
  score: number | null;
}

/** A scored pair the detector proposed, hydrated for review. */
export interface MergeCandidate {
  id: string;
  entityType: string;
  score: number;
  status: MergeCandidateStatus;
  detectedBy: string;
  detectorVersion: number;
  createdAt: Date;
  evidence: MergeCandidateEvidence[];
  /** Exactly the two people of the pair, `entity_id_a` first. */
  people: Person[];
}

export interface MergeCandidatePage {
  candidates: MergeCandidate[];
  /** Reviewable pairs in this status, ignoring the cursor. */
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/**
 * Opaque keyset cursor over the review order (`score DESC, id ASC`).
 *
 * Offset paging would be wrong here: accepting or rejecting a candidate takes
 * it out of the `pending` set, so every decision shifts the rows behind it and
 * an offset would silently skip the pair that moved up into the seam.
 */
export function encodeMergeCandidateCursor(candidate: { score: number; id: string }): string {
  return Buffer.from(`${candidate.score}::${candidate.id}`).toString('base64');
}

export function decodeMergeCandidateCursor(cursor: string): { score: number; id: string } | null {
  try {
    const [score, id] = Buffer.from(cursor, 'base64').toString('utf8').split('::');
    const parsed = Number(score);

    if (!Number.isFinite(parsed) || !id) {
      return null;
    }

    return { score: parsed, id };
  } catch {
    return null;
  }
}

function parseEvidence(raw: unknown): MergeCandidateEvidence[] {
  const list = typeof raw === 'string' ? safeJson(raw) : raw;

  if (!Array.isArray(list)) {
    return [];
  }

  return list.flatMap((item) => {
    if (item == null || typeof item !== 'object') {
      return [];
    }

    const row = item as Record<string, unknown>;
    const kind = typeof row.kind === 'string' ? row.kind : null;
    if (kind == null) {
      return [];
    }

    return [
      {
        kind,
        value: typeof row.value === 'string' ? row.value : String(row.value ?? ''),
        score: typeof row.score === 'number' ? row.score : null,
      },
    ];
  });
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Both endpoints still live, and the pair not permanently blocked.
 *
 * Shared verbatim by the page and its count so the "N pending" the UI shows can
 * never disagree with the rows underneath it.
 */
const LIVE_PAIR_PREDICATE = `EXISTS (
            SELECT 1 FROM ci.entities a
             WHERE a.owner_user_id = mc.owner_user_id
               AND a.entity_id = mc.entity_id_a
               AND a.entity_type = mc.entity_type
               AND COALESCE(a.is_active, true) = true
               AND a.merged_into_entity_id IS NULL)
          AND EXISTS (
            SELECT 1 FROM ci.entities b
             WHERE b.owner_user_id = mc.owner_user_id
               AND b.entity_id = mc.entity_id_b
               AND b.entity_type = mc.entity_type
               AND COALESCE(b.is_active, true) = true
               AND b.merged_into_entity_id IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM ci.entity_merge_blocks blk
             WHERE blk.owner_user_id = mc.owner_user_id
               AND blk.entity_id_a = mc.entity_id_a
               AND blk.entity_id_b = mc.entity_id_b)`;

interface CandidateRow {
  merge_candidate_id: string;
  entity_type: string;
  entity_id_a: string;
  entity_id_b: string;
  score: number | string;
  status: string;
  detected_by: string;
  detector_version: number | string;
  created_at: Date | string;
  evidence: unknown;
}

/**
 * The reader for `ci.merge_candidates` — the review queue the duplicate
 * detector has been filling.
 *
 * `clean.duplicate_detect` scores pairs and files them here with the evidence
 * that justified each one, but until this service nothing ever SELECTed the
 * table: the pipeline's whole output was invisible to the user. This turns it
 * into a queue that can be paged, and {@link resolvePairs} closes the loop by
 * stamping the outcome of a merge or a rejection back onto the row.
 *
 * Distinct from {@link PersonDuplicateService}, which recomputes cruder exact
 * email/phone/name groups from `ci.entities.properties` on every call. Both
 * feed the same review UI; only this one carries a score and its evidence.
 */
@Injectable()
export class MergeCandidateService {
  constructor(
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(MergeCandidateService.name);
  }

  /**
   * One page of candidates for `entityType`, strongest score first.
   *
   * Rows whose people no longer exist as live entities are skipped rather than
   * returned half-hydrated: a pair merged (or tombstoned) elsewhere is not a
   * question the user can still answer. Pairs already recorded in
   * `ci.entity_merge_blocks` are excluded too — that table is the permanent
   * "never ask again", and it outlives any single detector generation.
   */
  async findCandidates(
    context: UserServiceContext,
    options: {
      status?: MergeCandidateStatus;
      entityType?: string;
      limit?: number;
      after?: string | null;
    } = {},
  ): Promise<MergeCandidatePage> {
    const status = options.status ?? 'pending';
    const entityType = options.entityType ?? 'Person';
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = options.after ? decodeMergeCandidateCursor(options.after) : null;

    // One extra row answers hasNextPage without a second round-trip.
    const rows: CandidateRow[] = await this.personRepository.manager.query(
      `SELECT mc.merge_candidate_id, mc.entity_type, mc.entity_id_a, mc.entity_id_b,
              mc.score, mc.status, mc.detected_by, mc.detector_version, mc.created_at, mc.evidence
         FROM ci.merge_candidates mc
        WHERE mc.owner_user_id = $1
          AND mc.entity_type = $2
          AND mc.status = $3
          AND ($4::float8 IS NULL
               OR mc.score < $4::float8
               OR (mc.score = $4::float8 AND mc.merge_candidate_id > $5::uuid))
          AND ${LIVE_PAIR_PREDICATE}
        ORDER BY mc.score DESC, mc.merge_candidate_id ASC
        LIMIT $6`,
      [context.userId, entityType, status, cursor?.score ?? null, cursor?.id ?? null, limit + 1],
    );

    const [countRow]: Array<{ total: number | string }> = await this.personRepository.manager.query(
      `SELECT COUNT(*)::int AS total
         FROM ci.merge_candidates mc
        WHERE mc.owner_user_id = $1
          AND mc.entity_type = $2
          AND mc.status = $3
          AND ${LIVE_PAIR_PREDICATE}`,
      [context.userId, entityType, status],
    );

    const totalCount = Number(countRow?.total ?? 0);
    const hasNextPage = rows.length > limit;
    const page = hasNextPage ? rows.slice(0, limit) : rows;

    if (page.length === 0) {
      return { candidates: [], totalCount, hasNextPage: false, endCursor: null };
    }

    const byId = await this.loadPeople(context, page);

    const candidates: MergeCandidate[] = [];
    for (const row of page) {
      const personA = byId.get(row.entity_id_a);
      const personB = byId.get(row.entity_id_b);

      // The SQL already required both endpoints to be live Persons; a miss here
      // means the repository read disagreed, so drop the pair rather than
      // render half of it.
      if (personA == null || personB == null) {
        continue;
      }

      candidates.push({
        id: row.merge_candidate_id,
        entityType: row.entity_type,
        score: Number(row.score),
        status: row.status as MergeCandidateStatus,
        detectedBy: row.detected_by,
        detectorVersion: Number(row.detector_version),
        createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
        evidence: parseEvidence(row.evidence),
        people: [personA, personB],
      });
    }

    const last = page[page.length - 1];

    return {
      candidates,
      totalCount,
      hasNextPage,
      endCursor: encodeMergeCandidateCursor({ score: Number(last.score), id: last.merge_candidate_id }),
    };
  }

  /**
   * Stamp the outcome of a user decision onto every pending candidate whose
   * BOTH endpoints are in `entityIds`.
   *
   * The set, not a pair, is the unit of the decision: the review UI merges (or
   * rejects) a whole group, so one click can settle several proposals at once.
   * Only `pending` rows move — a candidate the user already decided keeps the
   * first answer, matching the detector's own upsert rule.
   */
  async resolvePairs(
    context: UserServiceContext,
    entityIds: string[],
    status: Exclude<MergeCandidateStatus, 'pending'>,
  ): Promise<number> {
    const unique = [...new Set(entityIds)];

    if (unique.length < 2) {
      return 0;
    }

    const rows: Array<{ merge_candidate_id: string }> = await this.personRepository.manager.query(
      `UPDATE ci.merge_candidates
          SET status = $3, updated_at = now()
        WHERE owner_user_id = $1
          AND status = 'pending'
          AND entity_id_a = ANY($2::uuid[])
          AND entity_id_b = ANY($2::uuid[])
        RETURNING merge_candidate_id`,
      [context.userId, unique, status],
    );

    if (rows.length > 0) {
      this.logger.log('Resolved merge candidates', { status, entities: unique.length, rows: rows.length });
    }

    return rows.length;
  }

  private async loadPeople(context: UserServiceContext, rows: CandidateRow[]): Promise<Map<string, Person>> {
    const ids = [...new Set(rows.flatMap((row) => [row.entity_id_a, row.entity_id_b]))];

    const entities = await this.personRepository
      .createQueryBuilder('person')
      .where('person.owner_user_id = :userId', { userId: context.userId })
      .andWhere('person.entity_id IN (:...ids)', { ids })
      .getMany();

    return new Map(entities.map((entity) => [entity.id, PersonEntity.toEgressType(entity)]));
  }
}
