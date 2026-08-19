import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, type FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import { type ServiceContext, SYSTEM_USER } from '@ci/common/context';
import { computeChunkSize } from '@ci/common/persistence';
import { EventService } from '@ci/domains/events';
import {
  QuestionCreatedEvent,
  QuestionUpdatedEvent,
  QuestionRemovedEvent,
} from '@ci/domains/intelligence/events';

import { Question, QuestionEntity } from '../entities/QuestionEntity';
import type { CreateQuestionDto, QuestionCatalogueQueryDto, UpdateQuestionDto } from '../types';

const FEED_QUESTION_QUEUE_LIMIT = 3;
/** Unanswered front-of-queue questions rotate after this long on the feed. */
export const FEED_QUESTION_STALE_MS = 30 * 60 * 1000;

/**
 * Ask the functional questions first.
 *
 * `ci.questions.answer_tier` splits the catalogue into questions that settle a
 * fact ("What foods are you allergic to?"), questions that record a taste
 * ("Window or aisle?"), and questions that ask for a story ("How did you end up
 * in the city you live in now?"). A memory system earns the third kind by
 * getting the first two right, so every selector orders by this rank before it
 * applies its own tie-break.
 *
 * NULL sorts last, not first: an untiered row is a legacy question from the
 * pre-catalogue era, and those are exactly the abstract ones we do not want to
 * lead with. (Postgres defaults NULLs FIRST on DESC and LAST on ASC; spelling
 * the rank out as an integer avoids depending on that.)
 */
const TIER_RANK_SQL = `
  CASE q.answer_tier
    WHEN 'factual'    THEN 0
    WHEN 'preference' THEN 1
    WHEN 'narrative'  THEN 2
    ELSE 3
  END
`;

const GAP_AWARE_CANDIDATE_SQL = `
  WITH category_coverage AS (
    SELECT
      q.question_category AS category,
      COUNT(DISTINCT a.answer_id)::int AS answered_count
    FROM ci.questions q
    LEFT JOIN ci.answers a
      ON a.question_id = q.question_id
      AND a.user_id = $1
      AND a.answer_text IS NOT NULL
      AND TRIM(a.answer_text) <> ''
    WHERE q.is_active = TRUE
      AND (q.is_private_to IS NULL OR q.is_private_to = $1)
    GROUP BY q.question_category
  )
  SELECT q.question_id AS id
  FROM ci.questions q
  LEFT JOIN category_coverage cc ON cc.category = q.question_category
  WHERE q.is_active = TRUE
    AND (q.is_private_to IS NULL OR q.is_private_to = $1)
    AND NOT EXISTS (
      SELECT 1
      FROM ci.answers a
      WHERE a.question_id = q.question_id
        AND a.user_id = $1
        AND a.answer_text IS NOT NULL
        AND TRIM(a.answer_text) <> ''
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ci.feed_queue fq
      WHERE fq.user_id = $1
        AND fq.question_id = q.question_id
    )
  ORDER BY ${TIER_RANK_SQL} ASC, COALESCE(cc.answered_count, 0) ASC, RANDOM()
  LIMIT 1;
`;

/**
 * The caller's most recent real answer to each question, or nothing. A LATERAL
 * rather than a plain LEFT JOIN so a question that somehow carries two answer
 * rows still yields exactly one catalogue row.
 *
 * `$1` is the caller's user id (NULL for a system caller, which then matches no
 * answers — `= NULL` is NULL, not true).
 */
const CATALOGUE_ANSWER_LATERAL_SQL = `
  LEFT JOIN LATERAL (
    SELECT
      a.answer_id,
      a.answer_text,
      a.answer_source,
      a.answer_confidence,
      a.answer_rationale,
      a.answered_at
    FROM ci.answers a
    WHERE a.question_id = q.question_id
      AND a.user_id = $1::uuid
      AND a.answer_text IS NOT NULL
      AND TRIM(a.answer_text) <> ''
    ORDER BY a.answered_at DESC, a.answer_id DESC
    LIMIT 1
  ) a ON TRUE
`;

/**
 * Visibility + lifecycle + free-text predicate. Facets are computed against
 * THIS and not against the full predicate below: narrowing to one category must
 * not collapse the category picker to the one category already chosen.
 */
const CATALOGUE_BASE_WHERE_SQL = `
  (q.is_private_to IS NULL OR q.is_private_to = $1::uuid)
  AND ($2 = 'all' OR q.is_active = ($2 = 'active'))
  AND ($3::text IS NULL OR q.question_text ILIKE '%' || $3 || '%')
`;

const CATALOGUE_FULL_WHERE_SQL = `
  ${CATALOGUE_BASE_WHERE_SQL}
  AND ($4::text IS NULL OR q.question_category = $4)
  AND ($5::text IS NULL OR q.answer_tier = $5)
  AND ($6 = 'all' OR (a.answer_id IS NOT NULL) = ($6 = 'answered'))
`;

/** The answered/unanswered state of one catalogue row, for the browse surface. */
export interface QuestionCatalogueAnswer {
  id: string;
  text: string;
  /** 'user_input' | 'inferred' | 'observed' | 'imported' — drives AnswerProvenance. */
  source: string | null;
  confidence: number | null;
  rationale: string | null;
  answeredAt: Date;
}

export interface QuestionCatalogueEntry {
  id: string;
  text: string;
  category: string | null;
  answerTier: string | null;
  questionType: string | null;
  frequencyRecommendation: string | null;
  isActive: boolean;
  isSeedQuestion: boolean;
  createdByLlm: boolean;
  isPrivateTo: string | null;
  timesAsked: number;
  timesAnswered: number;
  createdAt: Date;
  updatedAt: Date;
  answer: QuestionCatalogueAnswer | null;
}

export interface QuestionCatalogueFacetBucket {
  value: string | null;
  count: number;
}

export interface QuestionCataloguePage {
  data: QuestionCatalogueEntry[];
  totalCount: number;
  limit: number;
  offset: number;
  facets: {
    categories: QuestionCatalogueFacetBucket[];
    answerTiers: QuestionCatalogueFacetBucket[];
    answeredCount: number;
    unansweredCount: number;
  };
}

/**
 * Make a user string safe to drop between `%…%` in an ILIKE. Without this a
 * search for `_` or `%` matches everything, and a trailing backslash makes the
 * pattern invalid. Backslash is Postgres' default LIKE escape character.
 */
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

type CatalogueRow = {
  id: string;
  text: string;
  category: string | null;
  answer_tier: string | null;
  question_type: string | null;
  frequency_recommendation: string | null;
  is_active: boolean;
  is_seed_question: boolean;
  created_by_llm: boolean;
  is_private_to: string | null;
  times_asked: number;
  times_answered: number;
  created_at: Date;
  updated_at: Date;
  answer_id: string | null;
  answer_text: string | null;
  answer_source: string | null;
  answer_confidence: number | null;
  answer_rationale: string | null;
  answered_at: Date | null;
  total_count: number;
};

type CatalogueFacetRow = {
  category: string | null;
  answer_tier: string | null;
  count: number;
  answered_count: number;
};

@Injectable()
export class QuestionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(QuestionEntity)
    private readonly questionRepository: Repository<QuestionEntity>,
    private readonly eventService: EventService,
  ) {}

  /**
   * Resolve the effective is_private_to for a question: an explicit value on the
   * DTO wins; otherwise a real (non-system) caller privatizes to themselves, and
   * a system caller leaves it public (null).
   */
  private resolveIsPrivateTo(context: ServiceContext, data: CreateQuestionDto): string | null {
    return data.isPrivateTo !== undefined
      ? data.isPrivateTo
      : context.userId && context.userId !== SYSTEM_USER
        ? context.userId
        : null;
  }

  /**
   * Which questions a caller may edit, keyed by id.
   *
   * Same rule as {@link findById}: the shared catalogue (`is_private_to IS
   * NULL`) plus the caller's own private questions, and never another user's.
   * It used to be own-private-ONLY, which meant nobody could correct or retire
   * any of the ~1.3k seeded catalogue rows — every one of them is public — while
   * `DELETE /questions/:id` still answered 204, because the controller checks
   * visibility with findById and then calls a writer with a stricter rule.
   *
   * `remove` deliberately keeps the stricter rule: ci.answers and ci.feed_queue
   * both cascade, so widening hard delete would let one caller destroy another's
   * answers. Retiring a catalogue question is `isActive: false`.
   */
  private writableWhere(context: ServiceContext, id: string): FindOptionsWhere<QuestionEntity>[] {
    if (context.userId === SYSTEM_USER) {
      return [{ id }];
    }

    return [
      { id, isPrivateTo: IsNull() },
      { id, isPrivateTo: context.userId },
    ];
  }

  /**
   * @param options.emitCreated When true (default) a QuestionCreatedEvent is sent so
   *   the row indexes/enriches live. The bulk path passes false: emitting a per-row
   *   pgboss event for every ingested row is the dominant cost at import volume, so
   *   bulk-loaded rows are instead swept by the post-load search-index backfill.
   */
  async create(
    context: ServiceContext,
    data: CreateQuestionDto,
    options: { emitCreated?: boolean } = {},
  ): Promise<Question> {
    const { emitCreated = true } = options;
    const id = data.id ?? uuidv7();

    const isPrivateTo = this.resolveIsPrivateTo(context, data);

    const instance = await this.questionRepository.create({
      id,
      text: data.text,
      category: data.category,
      answerTier: data.answerTier ?? null,
      isSeedQuestion: data.isSeedQuestion ?? false,
      createdByLlm: data.createdByLlm ?? false,
      frequencyRecommendation: data.frequencyRecommendation,
      isActive: data.isActive ?? true,
      isPrivateTo: isPrivateTo,
    });

    const entity = await this.questionRepository.save(instance);

    if (emitCreated) {
      await this.eventService.send(QuestionCreatedEvent, {
        questionId: id,
      });
    }

    return QuestionEntity.toEgressType(entity);
  }

  /**
   * Batch questions ingest. Replaces the per-row save + QuestionCreatedEvent loop
   * with one set-based INSERT plus one hydration SELECT. Questions have no dedup
   * key, so every input row is inserted; per-question logic (id allocation,
   * isPrivateTo resolution) is preserved. Returns the created questions in input
   * order.
   *
   * Bulk ingest does NOT emit a per-row QuestionCreatedEvent: the per-row pgboss
   * fan-out was the dominant cost at import volume. Search indexing for
   * bulk-loaded rows is deferred to the post-load batch embed
   * (POST /api/maintenance/search-index/backfill). Single-row create() still
   * emits, so interactive creates index live.
   */
  async createMany(context: ServiceContext, data: CreateQuestionDto[]): Promise<Question[]> {
    if (data.length === 0) {
      return [];
    }

    const entities = data.map((item) =>
      this.questionRepository.create({
        id: item.id ?? uuidv7(),
        text: item.text,
        category: item.category,
        answerTier: item.answerTier ?? null,
        isSeedQuestion: item.isSeedQuestion ?? false,
        createdByLlm: item.createdByLlm ?? false,
        frequencyRecommendation: item.frequencyRecommendation,
        isActive: item.isActive ?? true,
        isPrivateTo: this.resolveIsPrivateTo(context, item),
      }),
    );

    // Split into param-budget-bounded chunks so a large batch never exceeds
    // Postgres' 65535 bind-param limit (computeChunkSize is the same helper
    // bulkInsertIdempotent uses). Questions have no dedup key, so every chunk is
    // a plain multi-row INSERT.
    const chunkSize = computeChunkSize(this.questionRepository.metadata.columns.length);
    for (let offset = 0; offset < entities.length; offset += chunkSize) {
      await this.questionRepository
        .createQueryBuilder()
        .insert()
        // Route through `metadata.target` so TS picks the `ObjectLiteral` overload
        // of `.values()` (matches the other bulk-ingest services).
        .into(this.questionRepository.metadata.target)
        .values(entities.slice(offset, offset + chunkSize))
        .execute();
    }

    const ids = entities.map((entity) => entity.id);
    const rows = await this.questionRepository.find({ where: { id: In(ids) } });
    const byId = new Map(rows.map((row) => [row.id, row]));

    return entities.map((entity) => QuestionEntity.toEgressType(byId.get(entity.id) ?? entity));
  }

  async findAll(context: ServiceContext): Promise<Question[]> {
    const whereClauses: FindOptionsWhere<QuestionEntity>[] = [
      {
        isActive: true,
        isPrivateTo: IsNull(),
      },
    ];

    if (context?.userId !== SYSTEM_USER) {
      whereClauses.push({ isActive: true, isPrivateTo: context.userId });
    }

    const result = await this.questionRepository.find({
      where: whereClauses,
    });

    const unique = new Map<string, QuestionEntity>();

    for (const entity of result) {
      unique.set(entity.id, entity);
    }

    return Array.from(unique.values()).map((entity) => QuestionEntity.toEgressType(entity));
  }

  /**
   * The reflection catalogue, browsable: paged, filterable by category / answer
   * tier / lifecycle / answered-state and searchable by text, with each row
   * carrying the caller's own answer (and its provenance) when one exists.
   *
   * `findAll` cannot serve this — it returns only active questions, applies no
   * filters, and hands the whole catalogue to the caller to slice in memory.
   * At ~1.3k active rows that is already the difference between a page and a
   * full table scan on every keystroke.
   */
  async findCatalogue(
    context: ServiceContext,
    query: QuestionCatalogueQueryDto,
  ): Promise<QuestionCataloguePage> {
    const { status, answered, limit, offset } = query;
    const userId = context.userId === SYSTEM_USER ? null : context.userId;
    const search = query.search ? escapeLikeTerm(query.search) : null;

    // Positions are shared between the page query and the facet query, so the
    // two predicates stay in lockstep. $4..$6 are page-only.
    const params = [
      userId,
      status,
      search,
      query.category ?? null,
      query.answerTier ?? null,
      answered,
      limit,
      offset,
    ];

    const rows = (await this.dataSource.query(
      `
      SELECT
        q.question_id AS id,
        q.question_text AS text,
        q.question_category AS category,
        q.answer_tier,
        q.question_type,
        q.frequency_recommendation,
        q.is_active,
        q.is_seed_question,
        q.created_by_llm,
        q.is_private_to,
        q.times_asked,
        q.times_answered,
        q.created_at,
        q.updated_at,
        a.answer_id,
        a.answer_text,
        a.answer_source,
        a.answer_confidence,
        a.answer_rationale,
        a.answered_at,
        COUNT(*) OVER ()::int AS total_count
      FROM ci.questions q
      ${CATALOGUE_ANSWER_LATERAL_SQL}
      WHERE ${CATALOGUE_FULL_WHERE_SQL}
      ORDER BY
        q.question_category ASC NULLS LAST,
        ${TIER_RANK_SQL} ASC,
        q.question_text ASC,
        q.question_id ASC
      LIMIT $7 OFFSET $8;
      `,
      params,
    )) satisfies Array<CatalogueRow>;

    // The facet query ignores $4..$6 but is handed the same array: node-postgres
    // tolerates unreferenced trailing params only when they are not passed, so
    // slice down to what the statement actually uses.
    const facetRows = (await this.dataSource.query(
      `
      SELECT
        q.question_category AS category,
        q.answer_tier,
        COUNT(*)::int AS count,
        COUNT(*) FILTER (WHERE a.answer_id IS NOT NULL)::int AS answered_count
      FROM ci.questions q
      ${CATALOGUE_ANSWER_LATERAL_SQL}
      WHERE ${CATALOGUE_BASE_WHERE_SQL}
      GROUP BY 1, 2;
      `,
      params.slice(0, 3),
    )) satisfies Array<CatalogueFacetRow>;

    const categories = new Map<string | null, number>();
    const answerTiers = new Map<string | null, number>();
    let answeredCount = 0;
    let unansweredCount = 0;

    for (const row of facetRows) {
      const count = Number(row.count);
      const answeredInBucket = Number(row.answered_count);

      categories.set(row.category, (categories.get(row.category) ?? 0) + count);
      answerTiers.set(row.answer_tier, (answerTiers.get(row.answer_tier) ?? 0) + count);
      answeredCount += answeredInBucket;
      unansweredCount += count - answeredInBucket;
    }

    // The window count rides on the rows, so an empty page carries none. That is
    // usually because nothing matched — but it is also what a page past the end
    // looks like (deactivate the last row on the last page and you are there),
    // and reporting 0 then would tell the pager there is nothing to go back to.
    const totalCount =
      rows.length > 0
        ? Number(rows[0].total_count)
        : offset === 0
          ? 0
          : Number(
              (
                (await this.dataSource.query(
                  `
                  SELECT COUNT(*)::int AS total_count
                  FROM ci.questions q
                  ${CATALOGUE_ANSWER_LATERAL_SQL}
                  WHERE ${CATALOGUE_FULL_WHERE_SQL};
                  `,
                  params.slice(0, 6),
                )) satisfies Array<{ total_count: number }>
              )[0]?.total_count ?? 0,
            );

    const toSortedBuckets = (buckets: Map<string | null, number>): QuestionCatalogueFacetBucket[] =>
      Array.from(buckets.entries())
        .map(([value, count]) => ({ value, count }))
        // Untiered/uncategorised rows sort last — they are the pre-catalogue
        // leftovers, not something to lead a picker with.
        .sort((left, right) =>
          left.value === null ? 1 : right.value === null ? -1 : left.value.localeCompare(right.value),
        );

    return {
      data: rows.map((row) => ({
        id: row.id,
        text: row.text,
        category: row.category,
        answerTier: row.answer_tier,
        questionType: row.question_type,
        frequencyRecommendation: row.frequency_recommendation,
        isActive: row.is_active,
        isSeedQuestion: row.is_seed_question,
        createdByLlm: row.created_by_llm,
        isPrivateTo: row.is_private_to,
        timesAsked: Number(row.times_asked),
        timesAnswered: Number(row.times_answered),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        answer:
          row.answer_id && row.answer_text
            ? {
                id: row.answer_id,
                text: row.answer_text,
                source: row.answer_source,
                confidence: row.answer_confidence,
                rationale: row.answer_rationale,
                answeredAt: row.answered_at as Date,
              }
            : null,
      })),
      totalCount,
      limit,
      offset,
      facets: {
        categories: toSortedBuckets(categories),
        answerTiers: toSortedBuckets(answerTiers),
        answeredCount,
        unansweredCount,
      },
    };
  }

  async findById(context: ServiceContext, id: string): Promise<Question | null> {
    const whereClauses: FindOptionsWhere<QuestionEntity>[] = [
      {
        id: id,
        isPrivateTo: IsNull(),
      },
    ];

    if (context?.userId && context.userId !== SYSTEM_USER) {
      whereClauses.push({ id: id, isPrivateTo: context.userId });
    }

    const result = await this.questionRepository.findOne({
      where: whereClauses,
    });

    return result ? QuestionEntity.toEgressType(result) : null;
  }

  async findByIds(context: ServiceContext, ids: string[]): Promise<Question[]> {
    const whereClauses: FindOptionsWhere<QuestionEntity>[] = [
      {
        id: In(ids),
        isPrivateTo: IsNull(),
      },
    ];

    if (context?.userId && context.userId !== SYSTEM_USER) {
      whereClauses.push({ id: In(ids), isPrivateTo: context.userId });
    }

    const results = await this.questionRepository.find({
      where: whereClauses,
    });

    const unique = new Map<string, QuestionEntity>();

    for (const entity of results) {
      unique.set(entity.id, entity);
    }

    return Array.from(unique.values()).map((entity) => QuestionEntity.toEgressType(entity));
  }

  async update(
    context: ServiceContext,
    questionId: string,
    data: UpdateQuestionDto,
  ): Promise<Question | null> {
    const updateData: Partial<QuestionEntity> = {};

    // `subcategory` is the historical spelling; `category` wins when both come in.
    if (data.subcategory !== undefined) {
      updateData.category = data.subcategory;
    }

    if (data.category !== undefined) {
      updateData.category = data.category;
    }

    if (data.answerTier !== undefined) {
      updateData.answerTier = data.answerTier;
    }

    if (data.text !== undefined) {
      updateData.text = data.text;
    }

    if (data.contextTags !== undefined) {
      updateData.contextTags = data.contextTags;
    }

    if (data.questionType !== undefined) {
      updateData.questionType = data.questionType;
    }

    if (data.isSeedQuestion !== undefined) {
      updateData.isSeedQuestion = data.isSeedQuestion;
    }

    if (data.isActive !== undefined) {
      updateData.isActive = data.isActive;
    }

    if (data.createdByLlm !== undefined) {
      updateData.createdByLlm = data.createdByLlm;
    }

    if (data.frequencyRecommendation !== undefined) {
      updateData.frequencyRecommendation = data.frequencyRecommendation;
    }

    if (data.timesAsked !== undefined) {
      updateData.timesAsked = data.timesAsked;
    }

    if (data.timesAnswered !== undefined) {
      updateData.timesAnswered = data.timesAnswered;
    }

    if (data.isPrivateTo !== undefined) {
      updateData.isPrivateTo = data.isPrivateTo;
    }

    const question = await this.questionRepository.findOne({
      where: this.writableWhere(context, questionId),
    });

    if (question) {
      Object.assign(question, updateData);
      await this.questionRepository.save(question);
    } else {
      return null;
    }

    await this.eventService.send(QuestionUpdatedEvent, {
      questionId: questionId,
    });

    return this.findById(context, questionId);
  }

  async remove(context: ServiceContext, id: string): Promise<boolean> {
    const question = await this.questionRepository.findOne({
      where: {
        id: id,
        ...(context.userId !== SYSTEM_USER && {
          isPrivateTo: context.userId,
        }),
      },
    });

    if (!question) {
      return false;
    }

    await this.questionRepository.delete({
      id,
      ...(context.userId !== SYSTEM_USER && {
        isPrivateTo: context.userId,
      }),
    });

    await this.eventService.send(QuestionRemovedEvent, {
      questionId: id,
    });

    return true;
  }

  async findUnansweredByUserId(): Promise<Map<string | null, string[]>> {
    // TODO: We need to refine how we're selecting "unanswered questions".
    //
    // This first cut gets the fundamentals roughly nailed down.
    //
    // OK, so what about multiple tenants on a server box? How do we make sure
    // that we're not choking out user answer processing because of a noisy neighbor?
    // We can consider querying for top 5 for every user.
    //
    // How do we achieve stability? It's likely the best answer we're going to get to
    // a question is a user-provided one. We might consider answers "stable" if they
    // have such an answer. We can offer users a way to correct LLM infererences.
    //
    // Otherwise how could we consider an answer good enough? It's possible we
    // could infer a second answer that would be worse than the first.
    //
    // Point being that there are rough edges here that we need to refine. But the
    // concept of "get me unaswered questions by user," can clearly live here.

    type Row = {
      id: string;
      user_id: string | null;
    };

    const rows = (await this.dataSource.query(`
      WITH unanswered AS (
        SELECT
          q.question_id AS id,
          COALESCE(q.is_private_to, u.user_id) AS user_id,
          q.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(q.is_private_to, u.user_id)
            ORDER BY ${TIER_RANK_SQL} ASC, q.created_at ASC
          ) AS rn
        FROM ci.questions q
        CROSS JOIN (SELECT DISTINCT id AS user_id FROM ci.users WHERE id IS NOT NULL) u
        WHERE q.is_active = TRUE
          AND (q.is_private_to IS NULL OR q.is_private_to = u.user_id)
          AND NOT EXISTS (
            SELECT 1
            FROM ci.answers a
            WHERE a.question_id = q.question_id
              AND a.user_id = u.user_id
              AND a.answer_method IN ('user', 'inferred')
              AND a.answer_text IS NOT NULL
              AND TRIM(a.answer_text) <> ''
          )
      )
      SELECT id, user_id
      FROM unanswered
      WHERE rn <= 1;
    `)) satisfies Array<Row>;

    const groupedByUserId = new Map<string | null, string[]>();

    for (const row of rows) {
      const userId = row.user_id;

      if (!groupedByUserId.has(userId)) {
        groupedByUserId.set(userId, []);
      }

      groupedByUserId.get(userId)!.push(row.id);
    }

    return groupedByUserId;
  }

  async findOneUnanswered(context: ServiceContext): Promise<Question | null> {
    if (!context.userId || context.userId === SYSTEM_USER) {
      return null;
    }

    await this.cleanupFeedQueue(context.userId);
    await this.rotateStaleFeedQuestions(context.userId);
    await this.ensureFeedQueueHasQuestion(context.userId);

    type Row = {
      id: string;
      feed_queue_id: string;
    };

    const rows = (await this.dataSource.query(
      `
      SELECT
        q.question_id as id,
        fq.feed_queue_id
      FROM
        ci.feed_queue as fq
      JOIN ci.questions as q ON q.question_id = fq.question_id
      LEFT JOIN ci.answers as a ON a.question_id = fq.question_id
        AND a.user_id = fq.user_id
      WHERE fq.user_id = $1
        AND fq.question_id IS NOT NULL
        AND q.is_active = TRUE
        AND (a.answer_id IS NULL OR a.answer_text IS NULL OR TRIM(a.answer_text) = '')
      ORDER BY fq.enqueued_at ASC, fq.feed_queue_id ASC
      LIMIT 1;
    `,
      [context.userId],
    )) satisfies Array<Row>;

    if (rows.length === 0) {
      return null;
    }

    const { id: questionId, feed_queue_id: feedQueueId } = rows[0];
    await this.recordFeedQuestionPresentation(context.userId, questionId);

    const question = await this.findById(context, questionId);
    if (!question) {
      return null;
    }

    return Object.assign(question, { presentationId: feedQueueId });
  }

  /**
   * Move a front-of-queue question that was shown but left unanswered for too
   * long to the back and top up with a fresh pick when possible.
   */
  async rotateStaleFeedQuestions(userId: string): Promise<boolean> {
    type FrontRow = {
      feed_queue_id: string;
      question_id: string;
      metadata: Record<string, unknown> | null;
    };

    const frontRows = (await this.dataSource.query(
      `
      SELECT
        fq.feed_queue_id,
        fq.question_id,
        fq.metadata
      FROM ci.feed_queue fq
      JOIN ci.questions q ON q.question_id = fq.question_id
      LEFT JOIN ci.answers a
        ON a.question_id = fq.question_id
        AND a.user_id = fq.user_id
      WHERE fq.user_id = $1
        AND fq.question_id IS NOT NULL
        AND q.is_active = TRUE
        AND (a.answer_id IS NULL OR a.answer_text IS NULL OR TRIM(a.answer_text) = '')
      ORDER BY fq.enqueued_at ASC, fq.feed_queue_id ASC
      LIMIT 1;
      `,
      [userId],
    )) satisfies Array<FrontRow>;

    const front = frontRows[0];
    if (!front) {
      return false;
    }

    const lastPresentedRaw = front.metadata?.lastPresentedAt;
    if (typeof lastPresentedRaw !== 'string') {
      return false;
    }

    const lastPresentedAt = Date.parse(lastPresentedRaw);
    if (!Number.isFinite(lastPresentedAt) || Date.now() - lastPresentedAt < FEED_QUESTION_STALE_MS) {
      return false;
    }

    await this.dataSource.query(
      `
      UPDATE ci.feed_queue
      SET
        enqueued_at = NOW(),
        metadata = (COALESCE(metadata, '{}'::jsonb) - 'lastPresentedAt') || jsonb_build_object('rotatedAt', to_jsonb(NOW()::text))
      WHERE feed_queue_id = $1;
      `,
      [front.feed_queue_id],
    );

    await this.enqueueNextFeedQueueQuestion(userId, FEED_QUESTION_QUEUE_LIMIT);

    return true;
  }

  /** Stamp first presentation time on the feed row and bump times_asked on the question. */
  async recordFeedQuestionPresentation(userId: string, questionId: string): Promise<void> {
    type Row = { updated: boolean };
    const rows = (await this.dataSource.query(
      `
      UPDATE ci.feed_queue
      SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('lastPresentedAt', to_jsonb(NOW()::text))
      WHERE user_id = $1
        AND question_id = $2
        AND (metadata->>'lastPresentedAt' IS NULL)
      RETURNING TRUE AS updated;
      `,
      [userId, questionId],
    )) satisfies Array<Row>;

    if (!rows[0]?.updated) {
      return;
    }

    await this.dataSource.query(
      `
      UPDATE ci.questions
      SET times_asked = times_asked + 1
      WHERE question_id = $1;
      `,
      [questionId],
    );
  }

  /** Ensure at least one unanswered question is queued when candidates exist. */
  async ensureFeedQueueHasQuestion(userId: string): Promise<boolean> {
    type QueueCountRow = { count: string };
    const countRows = (await this.dataSource.query(
      `
      SELECT COUNT(*)::text AS count
      FROM ci.feed_queue fq
      JOIN ci.questions q ON q.question_id = fq.question_id
      LEFT JOIN ci.answers a
        ON a.question_id = fq.question_id
        AND a.user_id = fq.user_id
      WHERE fq.user_id = $1
        AND fq.question_id IS NOT NULL
        AND q.is_active = TRUE
        AND (a.answer_id IS NULL OR a.answer_text IS NULL OR TRIM(a.answer_text) = '');
      `,
      [userId],
    )) satisfies Array<QueueCountRow>;

    const activeCount = Number.parseInt(countRows[0]?.count ?? '0', 10);
    if (activeCount > 0) {
      return false;
    }

    return this.enqueueNextFeedQueueQuestion(userId, 1);
  }

  async listFeedQueueUserIds(): Promise<string[]> {
    type Row = {
      id: string;
    };

    const rows = (await this.dataSource.query(
      `
      SELECT id
      FROM ci.users
      WHERE onboarded = TRUE
      ORDER BY created_at ASC;
      `,
    )) satisfies Array<Row>;

    return rows.map((row) => row.id);
  }

  async enqueueNextFeedQueueQuestion(
    userId: string,
    maxQueueSize = FEED_QUESTION_QUEUE_LIMIT,
  ): Promise<boolean> {
    await this.cleanupFeedQueue(userId);

    type QueueCountRow = {
      count: string;
    };
    const countRows = (await this.dataSource.query(
      `
      SELECT COUNT(*)::text as count
      FROM ci.feed_queue
      WHERE user_id = $1
        AND question_id IS NOT NULL;
      `,
      [userId],
    )) satisfies Array<QueueCountRow>;
    const queueSize = Number.parseInt(countRows[0]?.count ?? '0', 10);

    if (queueSize >= maxQueueSize) {
      return false;
    }

    type CandidateRow = {
      id: string;
    };
    const candidates = (await this.dataSource.query(GAP_AWARE_CANDIDATE_SQL, [
      userId,
    ])) satisfies Array<CandidateRow>;

    const candidate = candidates[0];
    if (!candidate) {
      return false;
    }

    const insertedRows = (await this.dataSource.query(
      `
      INSERT INTO ci.feed_queue (feed_queue_id, user_id, question_id, enqueued_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (user_id, question_id) DO NOTHING
      RETURNING question_id;
      `,
      [uuidv7(), userId, candidate.id],
    )) satisfies Array<{ question_id: string }>;

    return insertedRows.length > 0;
  }

  async removeFromFeedQueue(userId: string, questionId: string): Promise<void> {
    await this.dataSource.query(
      `
      DELETE FROM ci.feed_queue
      WHERE user_id = $1
        AND question_id = $2;
      `,
      [userId, questionId],
    );
  }

  /**
   * Batched {@link removeFromFeedQueue}: drop every listed question from the
   * user's feed in a single DELETE. Used by the bulk answer-ingest path so
   * answering N questions costs one query instead of N.
   */
  async removeManyFromFeedQueue(userId: string, questionIds: string[]): Promise<void> {
    if (questionIds.length === 0) {
      return;
    }

    await this.dataSource.query(
      `
      DELETE FROM ci.feed_queue
      WHERE user_id = $1
        AND question_id = ANY($2::uuid[]);
      `,
      [userId, questionIds],
    );
  }

  private async cleanupFeedQueue(userId: string): Promise<void> {
    await this.dataSource.query(
      `
      DELETE FROM ci.feed_queue as fq
      USING ci.answers as a
      WHERE fq.user_id = $1
        AND fq.question_id IS NOT NULL
        AND a.user_id = fq.user_id
        AND a.question_id = fq.question_id
        AND a.answer_text IS NOT NULL;
      `,
      [userId],
    );

    await this.dataSource.query(
      `
      DELETE FROM ci.feed_queue as fq
      WHERE fq.user_id = $1
        AND fq.question_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM ci.questions as q
          WHERE q.question_id = fq.question_id
            AND q.is_active = TRUE
        );
      `,
      [userId],
    );
  }
}
