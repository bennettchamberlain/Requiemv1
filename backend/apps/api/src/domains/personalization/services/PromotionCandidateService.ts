import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v7 as uuid7 } from 'uuid';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import {
  GraphIngestService,
  type GraphEntityInputDto,
  type GraphRelationshipInputDto,
} from '@ci/domains/graph';
import { AnswerService } from '@ci/domains/intelligence';

import { PromotionCandidateEntity, type PromotionCandidate } from '../entities/PromotionCandidateEntity';
import type { PromotionCandidateKind } from '../types';

export interface CreatePromotionCandidateDto {
  readonly kind: PromotionCandidateKind;
  readonly payload: Record<string, unknown>;
  readonly confidence: number;
  readonly evidence?: unknown[];
  readonly sourceJob?: string;
  readonly requiresUserInput?: boolean;
  readonly reviewPrompt?: string;
}

@Injectable()
export class PromotionCandidateService {
  constructor(
    @InjectRepository(PromotionCandidateEntity)
    private readonly repository: Repository<PromotionCandidateEntity>,
    private readonly graphIngestService: GraphIngestService,
    private readonly answerService: AnswerService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(PromotionCandidateService.name);
  }

  async create(
    context: UserServiceContext,
    dto: CreatePromotionCandidateDto,
  ): Promise<PromotionCandidate | null> {
    const userId = context.userId!;

    if (dto.kind === 'inferred_fact') {
      const questionId = dto.payload.questionId as string | undefined;

      if (questionId) {
        const existingForQuestion = await this.findPendingInferredFactForQuestion(userId, questionId);
        if (existingForQuestion) {
          existingForQuestion.payload = dto.payload;
          existingForQuestion.reviewPrompt = dto.reviewPrompt ?? existingForQuestion.reviewPrompt;
          existingForQuestion.confidence = dto.confidence;

          const saved = await this.repository.save(existingForQuestion);

          return saved as PromotionCandidate;
        }
      }

      if (await this.hasPendingInferredFactReview(userId)) {
        this.logger.log('Skipped inferred-answer review — another review is already pending', {
          userId,
          questionId,
        });

        return null;
      }
    }

    const entity = this.repository.create({
      id: uuid7(),
      userId,
      kind: dto.kind,
      payload: dto.payload,
      confidence: dto.confidence,
      evidence: dto.evidence ?? [],
      status: 'pending',
      sourceJob: dto.sourceJob ?? null,
      requiresUserInput: dto.requiresUserInput ?? true,
      reviewPrompt: dto.reviewPrompt ?? null,
    });

    const saved = await this.repository.save(entity);

    return saved as PromotionCandidate;
  }

  async hasPendingInferredFactReview(userId: string): Promise<boolean> {
    const count = await this.repository.count({
      where: { userId, status: 'pending', kind: 'inferred_fact' },
    });

    return count > 0;
  }

  async findPendingInferredFactForQuestion(
    userId: string,
    questionId: string,
  ): Promise<PromotionCandidateEntity | null> {
    return this.repository
      .createQueryBuilder('pc')
      .where('pc.user_id = :userId', { userId })
      .andWhere('pc.status = :status', { status: 'pending' })
      .andWhere('pc.kind = :kind', { kind: 'inferred_fact' })
      .andWhere("pc.payload->>'questionId' = :questionId", { questionId })
      .getOne();
  }

  async listPending(context: UserServiceContext, limit = 1): Promise<PromotionCandidate[]> {
    const rows = await this.repository.find({
      where: { userId: context.userId!, status: 'pending' },
      order: { createdAt: 'ASC' },
      take: limit,
    });

    return rows as PromotionCandidate[];
  }

  async accept(context: UserServiceContext, candidateId: string): Promise<PromotionCandidate | null> {
    const candidate = await this.repository.findOne({
      where: { id: candidateId, userId: context.userId! },
    });

    if (!candidate || candidate.status !== 'pending') {
      return null;
    }

    await this.applyCandidate(context, candidate);
    candidate.status = 'accepted';
    await this.repository.save(candidate);

    return candidate as PromotionCandidate;
  }

  async reject(context: UserServiceContext, candidateId: string): Promise<PromotionCandidate | null> {
    const candidate = await this.repository.findOne({
      where: { id: candidateId, userId: context.userId! },
    });

    if (!candidate || candidate.status !== 'pending') {
      return null;
    }

    candidate.status = 'rejected';
    await this.repository.save(candidate);

    return candidate as PromotionCandidate;
  }

  async countPending(userId: string): Promise<number> {
    return this.repository.count({ where: { userId, status: 'pending' } });
  }

  private async applyCandidate(
    context: UserServiceContext,
    candidate: PromotionCandidateEntity,
  ): Promise<void> {
    if (candidate.kind === 'inferred_fact') {
      const questionId = candidate.payload.questionId as string | undefined;
      const inferredText = candidate.payload.inferredText as string | undefined;

      if (questionId && inferredText) {
        const existing = await this.answerService.findByQuestionId(context, questionId);
        if (existing) {
          await this.answerService.update(context, existing.id, {
            text: inferredText,
            answerMethod: 'inferred',
            answerSource: 'rag',
          });
        } else {
          await this.answerService.create(context, {
            text: inferredText,
            question: { id: questionId },
            answerMethod: 'inferred',
            answerSource: 'rag',
          });
        }
      }
    } else if (candidate.kind === 'relationship' || candidate.kind === 'entity') {
      const entities = (candidate.payload.entities ?? []) as GraphEntityInputDto[];
      const relationships = (candidate.payload.relationships ?? []) as GraphRelationshipInputDto[];

      if (entities.length > 0 || relationships.length > 0) {
        await this.graphIngestService.ingest(context, { entities, relationships });
      }
    }

    this.logger.log('Promotion candidate accepted', {
      userId: context.userId,
      candidateId: candidate.id,
      kind: candidate.kind,
    });
  }
}
