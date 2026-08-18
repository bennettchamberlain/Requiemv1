import { ConflictException } from '@nestjs/common';

import type { CreateAskAnswerDto } from '../types';

import { AskAnswerService } from './AskAnswerService';

function makeService(existing: Record<string, unknown> | null = null) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockImplementation((data: Record<string, unknown>) => data),
    save: jest
      .fn()
      .mockImplementation((entity: Record<string, unknown>) =>
        Promise.resolve({ createdAt: new Date('2026-07-15T00:00:00Z'), ...entity }),
      ),
  };
  const logger = { setContext: jest.fn() };
  const service = new AskAnswerService(repo as never, logger as never);

  return { service, repo };
}

const DTO: CreateAskAnswerDto = {
  askId: 'ask-1',
  answer: {
    form: 'retrieval',
    items: [{ id: 'e1', type: 'file' }],
    disclosedCount: 1,
    withheldCount: 2,
    summary: 'Found 1 photo, withheld 2.',
    consentBasis: 'grant-1',
  },
};

describe('AskAnswerService.create — the terminal-disclosure idempotency guard', () => {
  it('persists the first answer for an ask', async () => {
    const { service, repo } = makeService(null);

    const result = await service.create(DTO);

    expect(repo.findOne).toHaveBeenCalledWith({ where: { askId: 'ask-1' } });
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        askId: 'ask-1',
        form: 'retrieval',
        answerSource: 'peer', // default when not supplied
        summary: 'Found 1 photo, withheld 2.',
        disclosedEntities: [{ id: 'e1', type: 'file' }],
        disclosedCount: 1,
        withheldCount: 2,
        consentBasis: 'grant-1',
      }),
    );
    expect(result.askId).toBe('ask-1');
  });

  it('honors an explicit answerSource over the peer default', async () => {
    const { service, repo } = makeService(null);

    await service.create({ ...DTO, answerSource: 'self' });

    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ answerSource: 'self' }));
  });

  // This is the regression the docstring names: a second run used to reuse
  // `existing.id` and save over it, silently reversing an owner's redaction
  // while the audit log — written once, by `AskService.complete`, which by
  // then refuses a terminal ask — kept reporting the ORIGINAL, fully-redacted
  // disclosure count. An answer row is terminal: insert-only, never mutated.
  it('refuses a second answer for the SAME ask with ConflictException, and never touches the row', async () => {
    const { service, repo } = makeService({
      id: 'answer-1',
      askId: 'ask-1',
      form: 'boolean',
      disclosedCount: 0,
      withheldCount: 5, // the owner's redaction: everything withheld
    });

    // A re-run supplies a DIFFERENT (unredacted) answer — this is exactly the
    // shape of the bug: if this silently overwrote, the redaction is reversed.
    const rerun: CreateAskAnswerDto = {
      askId: 'ask-1',
      answer: {
        form: 'retrieval',
        items: [
          { id: 'e1', type: 'file' },
          { id: 'e2', type: 'file' },
        ],
        disclosedCount: 5,
        withheldCount: 0,
        summary: 'Found 5 photos.',
        consentBasis: 'grant-1',
      },
    };

    await expect(service.create(rerun)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.create(rerun)).rejects.toThrow('Ask ask-1 already has an answer');
    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('scopes the duplicate check to askId, not the answer id', async () => {
    // A caller-supplied `id` on a fresh answer for an ask that already has ONE
    // must still be refused — the guard is per-ask, not per-row-id.
    const { service, repo } = makeService({ id: 'answer-1', askId: 'ask-1' });

    await expect(service.create({ ...DTO, id: 'answer-2' })).rejects.toBeInstanceOf(ConflictException);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { askId: 'ask-1' } });
  });
});

describe('AskAnswerService.findByAskId', () => {
  it('returns null when the ask has not been answered yet', async () => {
    const { service } = makeService(null);

    await expect(service.findByAskId('ask-1')).resolves.toBeNull();
  });

  it('returns the stored answer, mapped to its egress type', async () => {
    const { service } = makeService({
      id: 'answer-1',
      askId: 'ask-1',
      form: 'existence',
      answerSource: 'peer',
      summary: 'Yes.',
      disclosedEntities: [],
      disclosedCount: 0,
      withheldCount: 0,
      consentBasis: null,
      createdAt: new Date('2026-07-15T00:00:00Z'),
    });

    await expect(service.findByAskId('ask-1')).resolves.toMatchObject({
      askId: 'ask-1',
      form: 'existence',
      summary: 'Yes.',
    });
  });
});
