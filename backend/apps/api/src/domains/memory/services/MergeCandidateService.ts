import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { type Person, PersonEntity } from '../entities/PersonEntity';
import {
  PROFILE_FACTS_CORPUS_SQL,
  PROFILE_URL_EVIDENCE,
  PROFILE_URL_SCORES,
  ProfileUrlHolders,
  applyProfileVerdict,
  extractProfileFacts,
  profileFactsSqlObject,
  type ProfileFacts,
  type ProfileFactsCorpusRow,
  type ProfileVerdict,
} from '../utils/profileUrls';

import { PersonMergeService } from './PersonMergeService';

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
/** Rows per keyset page of the deterministic drain. */
const AUTO_MERGE_PAGE_SIZE = 100;

/** The verdict for a pair in which at least one side states no profile URL. */
const ABSENT: ProfileVerdict = { kind: 'absent' };

/**
 * The score a demoted row falls to when its live evidence no longer weighs
 * anything — e.g. a pair proposed only on a profile URL whose two sides now
 * state different profiles. The name floor: the weakest score any proposal
 * carries, so the row sits at the bottom of the queue, labelled, instead of
 * violating `merge_candidates_score_check (score > 0)`.
 */
const DEMOTED_FLOOR_SCORE = 0.5;

/**
 * The scheduler name of `DeterministicPersonMergeCron.drain`.
 *
 * Also the KILL SWITCH for the profile-URL tier: disabling this schedule on
 * the Jobs page stops the hourly drain, and the People page's on-read fold
 * reads the same setting and stops folding profile-URL pairs too. Email and
 * E.164-phone pairs keep folding on read, as they did before the cron existed.
 */
export const DETERMINISTIC_MERGE_CRON = 'DeterministicPersonMergeCron.drain';

export interface AutoMergeOptions {
  /** Wall-clock budget. The drain stops starting new merges once it is spent. */
  budgetMs: number;
  /** Fold pairs whose ONLY deterministic evidence is an exact profile URL. Default true. */
  includeProfileUrl?: boolean;
  /** Keyset page size. Default {@link AUTO_MERGE_PAGE_SIZE}. */
  pageSize?: number;
}

export interface AutoMergeResult {
  /** Pairs folded. */
  merged: number;
  /** Pairs left pending untouched: an endpoint gone, two self endpoints, a failed merge, the tier off. */
  skipped: number;
  /** Pairs whose live re-check failed and were rewritten to reviewable evidence. */
  demoted: number;
  /** Candidate rows read. */
  considered: number;
}

export function hasEmailEvidence(evidence: readonly MergeCandidateEvidence[]): boolean {
  return evidence.some((item) => item.kind === 'email');
}

/** Phone evidence at the E.164-exact tier — the same strength as an email. */
export function hasExactPhoneEvidence(evidence: readonly MergeCandidateEvidence[]): boolean {
  return evidence.some((item) => item.kind === 'phone' && item.score != null && item.score >= 0.95);
}

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

/**
 * These two people already share an identifier — a mailbox or an
 * international phone number.
 *
 * `ci.entity_identifiers` cannot answer this: it is unique on
 * `(owner, kind, value)`, so two live people cannot both hold the same email
 * there. Claims and properties still can, which is how the duplicates exist.
 */
const SHARES_EXACT_IDENTIFIER = `(
            mc.evidence @> '[{"kind":"email"}]'::jsonb
            OR EXISTS (
              SELECT 1
                FROM jsonb_array_elements(mc.evidence) ev
               WHERE ev->>'kind' = 'phone'
                 AND COALESCE((ev->>'score')::float, 0) >= 0.95)
            OR EXISTS (
              SELECT 1
                FROM ci.identifier_claims ca
                JOIN ci.identifier_claims cb
                  ON ca.owner_user_id = cb.owner_user_id
                 AND ca.kind = 'email'
                 AND cb.kind = 'email'
                 AND ca.value_normalized = cb.value_normalized
               WHERE ca.owner_user_id = mc.owner_user_id
                 AND ca.entity_id = mc.entity_id_a
                 AND cb.entity_id = mc.entity_id_b
                 AND ca.disposition IS DISTINCT FROM 'rejected'
                 AND cb.disposition IS DISTINCT FROM 'rejected')
            OR EXISTS (
              SELECT 1
                FROM ci.identifier_claims ca
                JOIN ci.identifier_claims cb
                  ON ca.owner_user_id = cb.owner_user_id
                 AND ca.kind = 'phone'
                 AND cb.kind = 'phone'
                 AND ca.value_e164 IS NOT NULL
                 AND ca.value_e164 = cb.value_e164
               WHERE ca.owner_user_id = mc.owner_user_id
                 AND ca.entity_id = mc.entity_id_a
                 AND cb.entity_id = mc.entity_id_b
                 AND ca.disposition IS DISTINCT FROM 'rejected'
                 AND cb.disposition IS DISTINCT FROM 'rejected')
            OR EXISTS (
              SELECT 1
                FROM ci.entities ea
                JOIN ci.entities eb
                  ON ea.owner_user_id = eb.owner_user_id
               WHERE ea.entity_id = mc.entity_id_a
                 AND eb.entity_id = mc.entity_id_b
                 AND (
                   (lower(btrim(COALESCE(ea.properties->>'email', ''))) <> ''
                    AND lower(btrim(ea.properties->>'email'))
                      = lower(btrim(eb.properties->>'email')))
                   OR EXISTS (
                     SELECT 1
                       FROM jsonb_array_elements_text(
                              COALESCE(ea.properties->'emails', '[]'::jsonb)
                            ) a_email
                       JOIN jsonb_array_elements_text(
                              COALESCE(eb.properties->'emails', '[]'::jsonb)
                            ) b_email
                         ON lower(btrim(a_email)) = lower(btrim(b_email))
                      WHERE lower(btrim(a_email)) <> '')))
          )`;

/**
 * The detector graded this pair's LinkedIn profile URLs `exact`: equal sets,
 * corroborated by a name token or a connection date, contradicted by neither.
 * See `utils/profileUrls.ts`.
 */
const SHARES_EXACT_PROFILE_URL = `EXISTS (
              SELECT 1
                FROM jsonb_array_elements(mc.evidence) ev
               WHERE ev->>'kind' = '${PROFILE_URL_EVIDENCE.match}'
                 AND COALESCE((ev->>'score')::float, 0) >= ${PROFILE_URL_SCORES.exact})`;

/**
 * The two people state DIFFERENT LinkedIn profiles (disjoint sets), or one
 * card lists a profile the other does not (overlapping, unequal sets). Either
 * outranks a shared email: two same-name people with different profiles are
 * two people, however they came to share a mailbox. A vetoed pair is NOT
 * hidden — it stays on the review queue, labelled, so a human can reject it
 * and make the rejection sticky.
 */
const PROFILE_URL_VETOED = `(
            mc.evidence @> '[{"kind":"${PROFILE_URL_EVIDENCE.conflict}"}]'::jsonb
            OR mc.evidence @> '[{"kind":"${PROFILE_URL_EVIDENCE.partial}"}]'::jsonb)`;

/**
 * These two people are the same person on deterministic evidence. That is
 * not a review question; it is a fold. Used both to select auto-merge work
 * and to keep leftovers off the People page while the drain catches up.
 *
 * Fully parenthesised on purpose: it is interpolated after `AND NOT`, and
 * `NOT a AND NOT b` is not `NOT (a AND NOT b)`.
 */
function sharesDeterministicIdentity(includeProfileUrl: boolean): string {
  const tiers = includeProfileUrl
    ? `(${SHARES_EXACT_IDENTIFIER}) OR (${SHARES_EXACT_PROFILE_URL})`
    : `(${SHARES_EXACT_IDENTIFIER})`;

  return `((${tiers}) AND NOT ${PROFILE_URL_VETOED})`;
}

/** Every deterministic tier, the profile URL included. */
export const SHARES_DETERMINISTIC_IDENTITY = sharesDeterministicIdentity(true);

/** One endpoint as the live re-check reads it. */
interface LiveEndpointRow {
  entity_id: string;
  person_name: string | null;
  profile_props: Record<string, unknown> | null;
  is_self: boolean | null;
}

interface LiveEndpoint {
  facts: ProfileFacts;
  isSelf: boolean;
}

interface DeterministicRow {
  merge_candidate_id: string;
  entity_id_a: string;
  entity_id_b: string;
  score: number | string;
  evidence: unknown;
  via_identifier: boolean | null;
}

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
    private readonly personMergeService: PersonMergeService,
  ) {
    this.logger.setContext(MergeCandidateService.name);
  }

  /**
   * Fold pending pairs that already share an identity, re-checking each one
   * against the LIVE rows immediately before it is merged.
   *
   * Three deterministic tiers qualify (see {@link SHARES_DETERMINISTIC_IDENTITY}):
   * a shared mailbox, an E.164-exact phone, and an exact LinkedIn profile URL.
   * Name overlap and last-ten-only phones stay on the queue for a human, and
   * no name clause exists in the predicate at all.
   *
   * ── The live re-check ──────────────────────────────────────────────────────
   *
   * The stored evidence is as old as the detector's last sweep. Between that
   * sweep and this merge, earlier merges fold properties together and
   * re-imports rewrite them, so every pair is re-adjudicated with the same
   * `ProfileUrlHolders.adjudicate` the detector used, on the endpoints as they
   * are NOW. A pair that no longer qualifies is DEMOTED — its row rewritten
   * with the live verdict's evidence — so it becomes visible for review
   * rather than hidden forever as "deterministic" and never merged:
   *
   *  - disjoint or partial URL sets demote any pair, email pairs included;
   *  - a pair that qualified ONLY through its profile URL demotes unless the
   *    live verdict is still `exact`;
   *  - with `includeProfileUrl: false` (the kill switch), a profile-only pair
   *    is left exactly as it is.
   *
   * ── The holder cap, on the live corpus ─────────────────────────────────────
   *
   * A URL stated by more than `PROFILE_URL_MAX_HOLDERS` people is removed
   * from both endpoints' facts before the verdict, exactly as the detector
   * removes it. The detector will not have written `exact` on such a URL, but
   * a URL can become over-common AFTER detection — a later import pastes it
   * into more cards — and the stored 0.95 would then carry a merge on a URL
   * that no longer identifies anyone. So the counts are read here, from the
   * corpus as it is now (`PROFILE_FACTS_CORPUS_SQL`, the detector's own
   * population), and such a pair's live verdict is `absent`: it demotes.
   *
   * The corpus is read at most once per call, and only when a pair's two
   * endpoints both state a URL (otherwise the verdict is `absent` whatever the
   * counts are), so draining email pairs between people with no profile costs
   * nothing extra. After each merge attempt both endpoints are re-read into
   * it, so a merged-away source stops counting and the target counts what the
   * merge folded into it.
   *
   * ── The self person ────────────────────────────────────────────────────────
   *
   * `users.entity_id` and any `is_self` row are always the merge TARGET, never
   * the source. A pair with two self endpoints is skipped and logged: folding
   * one "you" into another is a decision for the user, not a timer.
   * `PersonMergeService` independently refuses `users.entity_id` as a source.
   *
   * ── Paging and budget ──────────────────────────────────────────────────────
   *
   * Keyset paging on the review order `(score DESC, merge_candidate_id ASC)`,
   * so a pair that is skipped (or whose merge throws) is passed over for the
   * rest of this run instead of being re-selected at the head of every page.
   * The drain stops on an empty page or when `budgetMs` is spent; leftovers
   * are picked up by the next run.
   */
  async autoMergeDeterministicPairs(
    context: UserServiceContext,
    options: AutoMergeOptions,
  ): Promise<AutoMergeResult> {
    const includeProfileUrl = options.includeProfileUrl ?? true;
    const pageSize = Math.max(1, options.pageSize ?? AUTO_MERGE_PAGE_SIZE);
    const deadline = Date.now() + Math.max(0, options.budgetMs);
    const manager = this.personRepository.manager;
    const result: AutoMergeResult = { merged: 0, skipped: 0, demoted: 0, considered: 0 };

    const [userRow]: Array<{ entity_id: string | null }> = await manager.query(
      `SELECT entity_id FROM ci.users WHERE id = $1`,
      [context.userId],
    );
    const userSelfId = userRow?.entity_id ?? null;

    let cursor: { score: number; id: string } | null = null;
    /** Corpus-wide profile-URL holder counts. Loaded on first need; see "The holder cap". */
    let holders: ProfileUrlHolders | null = null;

    /** Read `ids` live into `endpoints`, keeping `holders` (once loaded) in step. */
    const refresh = async (endpoints: Map<string, LiveEndpoint>, ids: string[]): Promise<void> => {
      const fresh = await this.loadLiveEndpoints(context, ids);

      for (const id of ids) {
        const endpoint = fresh.get(id);

        if (endpoint == null) {
          endpoints.delete(id);
          holders?.delete(id);
        } else {
          endpoints.set(id, endpoint);
          holders?.set(id, endpoint.facts.urls);
        }
      }
    };

    drain: while (Date.now() < deadline) {
      const rows: DeterministicRow[] = await manager.query(
        `SELECT mc.merge_candidate_id, mc.entity_id_a, mc.entity_id_b, mc.score, mc.evidence,
                (${SHARES_EXACT_IDENTIFIER}) AS via_identifier
           FROM ci.merge_candidates mc
          WHERE mc.owner_user_id = $1
            AND mc.entity_type = 'Person'
            AND mc.status = 'pending'
            AND ${sharesDeterministicIdentity(includeProfileUrl)}
            AND ${LIVE_PAIR_PREDICATE}
            AND ($2::float8 IS NULL
                 OR mc.score < $2::float8
                 OR (mc.score = $2::float8 AND mc.merge_candidate_id > $3::uuid))
          ORDER BY mc.score DESC, mc.merge_candidate_id ASC
          LIMIT $4`,
        [context.userId, cursor?.score ?? null, cursor?.id ?? null, pageSize],
      );

      if (rows.length === 0) {
        break;
      }

      const last = rows[rows.length - 1];
      cursor = { score: Number(last.score), id: last.merge_candidate_id };
      result.considered += rows.length;

      const endpoints = new Map<string, LiveEndpoint>();
      await refresh(
        endpoints,
        rows.flatMap((row) => [row.entity_id_a, row.entity_id_b]),
      );

      for (const row of rows) {
        if (Date.now() >= deadline) {
          break drain;
        }

        // Any merge earlier on this page may have folded properties into, or
        // tombstoned, one of this row's endpoints. Re-read what is stale.
        const stale = [row.entity_id_a, row.entity_id_b].filter((id) => !endpoints.has(id));
        if (stale.length > 0) {
          await refresh(endpoints, stale);
        }

        const a = endpoints.get(row.entity_id_a);
        const b = endpoints.get(row.entity_id_b);

        if (a == null || b == null) {
          // Merged away or deactivated since the page was read. The pair is
          // moot, and LIVE_PAIR_PREDICATE drops it from every later read.
          result.skipped += 1;
          continue;
        }

        let verdict = ABSENT;

        if (a.facts.urls.size > 0 && b.facts.urls.size > 0) {
          holders ??= await this.loadProfileUrlHolders(context);
          verdict = holders.adjudicate(a.facts, b.facts);
        }

        const viaIdentifier = row.via_identifier === true;

        const demote =
          verdict.kind === 'conflict' ||
          verdict.kind === 'partial' ||
          (!viaIdentifier && includeProfileUrl && verdict.kind !== 'exact');

        if (demote) {
          result[(await this.demote(context, row, verdict)) ? 'demoted' : 'skipped'] += 1;
          continue;
        }

        if (!viaIdentifier && !includeProfileUrl) {
          // The profile tier is switched off: leave the row exactly as it is.
          result.skipped += 1;
          continue;
        }

        const aSelf = a.isSelf || row.entity_id_a === userSelfId;
        const bSelf = b.isSelf || row.entity_id_b === userSelfId;

        if (aSelf && bSelf) {
          this.logger.warn('Deterministic auto-merge skipped a pair with two self endpoints', {
            entityIdA: row.entity_id_a,
            entityIdB: row.entity_id_b,
          });
          result.skipped += 1;
          continue;
        }

        const targetId = bSelf ? row.entity_id_b : row.entity_id_a;
        const sourceId = targetId === row.entity_id_a ? row.entity_id_b : row.entity_id_a;

        try {
          await this.personMergeService.mergePeople(context, [sourceId], targetId);
          await this.resolvePairs(context, [row.entity_id_a, row.entity_id_b], 'accepted');
          result.merged += 1;
        } catch (err: unknown) {
          // A lock timeout, a deadlock with the other drain (cron vs on-read
          // fold), or an endpoint merged away under us. Left pending; the
          // keyset moves past it and the next run retries.
          this.logger.warn('Deterministic auto-merge skipped a pair', {
            err,
            entityIdA: row.entity_id_a,
            entityIdB: row.entity_id_b,
          });
          result.skipped += 1;
        }

        // Both endpoints changed: the target's properties now hold the
        // source's, and the source is a tombstone. Force a re-read — now,
        // when the holder counts are in use, so the cap sees the merge.
        endpoints.delete(sourceId);
        endpoints.delete(targetId);

        if (holders != null) {
          await refresh(endpoints, [sourceId, targetId]);
        }
      }
    }

    if (result.merged > 0 || result.demoted > 0) {
      this.logger.log('Auto-merged deterministic people', { ...result });
    }

    return result;
  }

  /**
   * Who states each profile URL across the owner's corpus: the counts the
   * holder cap reads. `PROFILE_FACTS_CORPUS_SQL` is the detector's own
   * population, so a URL is over-common to both callers or to neither.
   */
  private async loadProfileUrlHolders(context: UserServiceContext): Promise<ProfileUrlHolders> {
    const rows: ProfileFactsCorpusRow[] = await this.personRepository.manager.query(
      PROFILE_FACTS_CORPUS_SQL,
      [context.userId],
    );

    return new ProfileUrlHolders(
      rows.map((row) => [row.entity_id, extractProfileFacts(row.profile_props, row.person_name)] as const),
    );
  }

  /**
   * Live profile facts and self flags for `ids`, one query. Only live Persons
   * are returned, so an id missing from the map is a pair that is moot.
   */
  private async loadLiveEndpoints(
    context: UserServiceContext,
    ids: string[],
  ): Promise<Map<string, LiveEndpoint>> {
    const unique = [...new Set(ids)];

    if (unique.length === 0) {
      return new Map();
    }

    const rows: LiveEndpointRow[] = await this.personRepository.manager.query(
      `SELECT e.entity_id,
              e.name AS person_name,
              ${profileFactsSqlObject('e')} AS profile_props,
              (e.is_self IS TRUE OR e.properties->>'is_self' = 'true') AS is_self
         FROM ci.entities e
        WHERE e.owner_user_id = $1
          AND e.entity_id = ANY($2::uuid[])
          AND e.entity_type = 'Person'
          AND COALESCE(e.is_active, true) = true
          AND e.merged_into_entity_id IS NULL`,
      [context.userId, unique],
    );

    return new Map(
      rows.map((row) => [
        row.entity_id,
        { facts: extractProfileFacts(row.profile_props, row.person_name), isSelf: row.is_self === true },
      ]),
    );
  }

  /**
   * Rewrite a pending row's evidence under the LIVE verdict, so a pair that
   * no longer qualifies becomes a visible review question instead of a
   * "deterministic" row that is hidden and never merged. `status = 'pending'`
   * guards a concurrent human decision.
   *
   * Never throws: a failed rewrite leaves the row as it was, to be re-checked
   * on the next run, and must not fail the People page that triggered the
   * on-read fold. Returns whether the row was rewritten.
   */
  private async demote(
    context: UserServiceContext,
    row: DeterministicRow,
    verdict: ProfileVerdict,
  ): Promise<boolean> {
    const rewritten = applyProfileVerdict(
      { score: Number(row.score), evidence: parseEvidence(row.evidence) },
      verdict,
    );
    const score = rewritten.score > 0 ? rewritten.score : DEMOTED_FLOOR_SCORE;

    try {
      await this.personRepository.manager.query(
        `UPDATE ci.merge_candidates
            SET score = $3, evidence = $4::jsonb, updated_at = now()
          WHERE owner_user_id = $1
            AND merge_candidate_id = $2
            AND status = 'pending'`,
        [context.userId, row.merge_candidate_id, score, JSON.stringify(rewritten.evidence)],
      );
    } catch (err: unknown) {
      this.logger.warn('Could not demote a deterministic merge candidate; it stays as it was', {
        err,
        mergeCandidateId: row.merge_candidate_id,
      });

      return false;
    }

    this.logger.log('Demoted a deterministic merge candidate after a live re-check', {
      mergeCandidateId: row.merge_candidate_id,
      verdict: verdict.kind,
    });

    return true;
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
      /**
       * Whether the profile-URL tier is being folded. When the kill switch is
       * off, exact profile-URL pairs are NOT merged, so they are shown for
       * review instead of hidden. Default true.
       */
      includeProfileUrl?: boolean;
    } = {},
  ): Promise<MergeCandidatePage> {
    const status = options.status ?? 'pending';
    const entityType = options.entityType ?? 'Person';
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const cursor = options.after ? decodeMergeCandidateCursor(options.after) : null;
    // Deterministic pairs are folded (on read, and by the hourly drain); any
    // not yet folded must not appear as "are these the same person?" on the
    // review queue. A VETOED pair is not deterministic, so it stays visible.
    const hideDeterministic =
      status === 'pending' ? `AND NOT ${sharesDeterministicIdentity(options.includeProfileUrl ?? true)}` : '';

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
          ${hideDeterministic}
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
          AND ${LIVE_PAIR_PREDICATE}
          ${hideDeterministic}`,
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
