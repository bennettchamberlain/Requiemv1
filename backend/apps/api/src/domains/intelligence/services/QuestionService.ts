import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository, type FindOptionsWhere } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

import type { RequestContext } from '@ci/common/types';

import { QuestionEntity } from '../entities/QuestionEntity';
import type { CreateQuestionDto, Question } from '../types';

@Injectable()
export class QuestionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(QuestionEntity)
    private readonly questionRepository: Repository<QuestionEntity>,
  ) {}

  async create(context: RequestContext, data: CreateQuestionDto): Promise<Question> {
    const isPrivateTo = data.isPrivateTo !== undefined ? data.isPrivateTo : (context.userId ?? null);
    const instance = this.questionRepository.create({
      question_id: data.id ?? uuidv7(),
      question_text: data.text,
      question_category: data.subcategory,
      is_private_to: isPrivateTo,
    });

    const entity = await this.questionRepository.save(instance);

    return entity.toQuestion();
  }

  async findAll(context: RequestContext): Promise<Question[]> {
    const whereClauses: FindOptionsWhere<QuestionEntity>[] = [
      {
        is_active: true,
        is_private_to: IsNull(),
      },
    ];

    if (context.userId) {
      whereClauses.push({ is_active: true, is_private_to: context.userId });
    }

    const result = await this.questionRepository.find({
      where: whereClauses,
    });

    const unique = new Map<string, QuestionEntity>();

    for (const entity of result) {
      unique.set(entity.question_id, entity);
    }

    return Array.from(unique.values()).map((entity) => entity.toQuestion());
  }

  async findOne(context: RequestContext | null, id: string): Promise<Question | null> {
    // TODO: This is a footgun that we shouldn't leave here for long.
    //
    // What we're actually interested in doing is returning questions owned by the user in
    // addition to those that are unowned (user_id IS NULL). There isn't a clean way to
    // do this with the TypeORM query API, so we'd have to write raw SQL. Not inherently
    // a problem, but out of scope when this change was made.
    //
    // In the short term we're assuming that `findUnansweredByUserId` is sufficiently
    // secure and that no events are spawned manually that would undermine that security.
    const whereClauses: FindOptionsWhere<QuestionEntity>[] = [
      {
        question_id: id,
        is_private_to: IsNull(),
      },
    ];

    if (context?.userId) {
      whereClauses.push({ question_id: id, is_private_to: context.userId });
    }

    const result = await this.questionRepository.findOne({
      where: whereClauses,
    });

    return result?.toQuestion() ?? null;
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
      SELECT
        questions.question_id as id,
        COALESCE(questions.is_private_to, answers.user_id) as user_id
      FROM
        questions
      LEFT JOIN answers ON answers.question_id = questions.question_id
      WHERE questions.is_active = TRUE
        AND (answers.answer_id IS NULL OR answers.answer_text IS NULL)
        AND (
          questions.is_private_to IS NULL
          OR answers.user_id IS NULL
          OR answers.user_id = questions.is_private_to
        )
      LIMIT 5;
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

  async findOneUnanswered(context: RequestContext): Promise<Question | null> {
    if (!context.userId) {
      return null;
    }

    type Row = {
      id: string;
    };

    const rows = (await this.dataSource.query(
      `
      SELECT
        questions.question_id as id
      FROM
        questions
      LEFT JOIN answers ON answers.question_id = questions.question_id
        AND answers.user_id = $1
      WHERE questions.is_active = TRUE
        AND (answers.answer_id IS NULL OR answers.answer_text IS NULL)
        AND (
          questions.is_private_to IS NULL
          OR questions.is_private_to = $1
        )
      LIMIT 1;
    `,
      [context.userId],
    )) satisfies Array<Row>;

    if (rows.length === 0) {
      return null;
    }

    return this.findOne(context, rows[0].id);
  }
}
