import type { Repository } from 'typeorm';

import type { LoggerService } from '@ci/common/logging';
import type { GraphIngestService } from '@ci/domains/graph';
import type { AnswerService } from '@ci/domains/intelligence';

import type { PromotionCandidateEntity } from '../../entities/PromotionCandidateEntity';
import { PromotionCandidateService } from '../PromotionCandidateService';

describe('PromotionCandidateService', () => {
  const context = { userId: 'user-1' };

  function buildService(repository: Partial<Repository<PromotionCandidateEntity>>) {
    return new PromotionCandidateService(
      repository as Repository<PromotionCandidateEntity>,
      {} as GraphIngestService,
      {} as AnswerService,
      { setContext() {}, log() {} } as unknown as LoggerService,
    );
  }

  it('does not create a second inferred_fact review while one is pending', async () => {
    const repository = {
      createQueryBuilder: jest.fn(),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn(),
      save: jest.fn(),
    };

    const service = buildService(repository);

    const result = await service.create(context, {
      kind: 'inferred_fact',
      payload: { questionId: 'q-2', inferredText: 'Another answer' },
      confidence: 0.75,
    });

    expect(result).toBeNull();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('updates an existing pending inferred_fact for the same question instead of duplicating', async () => {
    const existing = {
      id: 'candidate-1',
      payload: { questionId: 'q-1', inferredText: 'Old answer' },
      reviewPrompt: 'old prompt',
      confidence: 0.75,
    } as unknown as PromotionCandidateEntity;

    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(existing),
    };

    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      count: jest.fn(),
      save: jest.fn().mockImplementation(async (entity) => entity),
    };

    const service = buildService(repository);

    const result = await service.create(context, {
      kind: 'inferred_fact',
      payload: { questionId: 'q-1', inferredText: 'New answer' },
      confidence: 0.8,
      reviewPrompt: 'new prompt',
    });

    expect(result?.payload).toEqual({ questionId: 'q-1', inferredText: 'New answer' });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewPrompt: 'new prompt',
        confidence: 0.8,
      }),
    );
  });
});
