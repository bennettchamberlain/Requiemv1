import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import type { RequestContext } from '@ci/common/types';

import { QuestionEntity } from '../entities/QuestionEntity';
import type { Question } from '../types';

@Injectable()
export class QuestionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(QuestionEntity)
    private readonly questionRepository: Repository<QuestionEntity>,
  ) {}

  async findAll(context: RequestContext): Promise<Question[]> {
    const result = await this.questionRepository.find({
      where: {
        user: {
          id: context.userId,
        },
      },
      relations: ['user'],
    });

    return result.map((entity) => entity.toQuestion());
  }

  async findOne(context: RequestContext, id: string): Promise<Question | null> {
    const result = await this.questionRepository.findOne({
      where: {
        user: {
          id: context.userId,
        },
        id,
      },
      relations: ['user'],
    });

    return result?.toQuestion() ?? null;
  }

  async findUnansweredByUserId(): Promise<Map<string, string[]>> {
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
      user_id: string;
    };

    const rows = (await this.dataSource.query(`
      SELECT
        questions.id as id,
        answers.user_id as user_id
      FROM
        questions
      LEFT JOIN answers ON answers.question_id = questions.id
      WHERE answers.rag_answer_1 IS NULL
      LIMIT 5;
    `)) satisfies Array<Row>;

    const groupedByUserId = new Map<string, string[]>();

    for (const row of rows) {
      const userId = row.user_id;

      if (!groupedByUserId.has(userId)) {
        groupedByUserId.set(userId, []);
      }

      groupedByUserId.get(userId)!.push(row.id);
    }

    return groupedByUserId;
  }
}
