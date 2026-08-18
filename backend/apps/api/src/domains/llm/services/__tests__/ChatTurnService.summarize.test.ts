import { DEFAULT_JOB_PRIORITY, INTERACTIVE_JOB_PRIORITY } from '@ci/domains/events';

import { LLM_QUEUE_OPTIONS } from '../../constants';
import { ChatTurnService } from '../ChatTurnService';

function buildService(overrides: {
  threadService?: unknown;
  messageService?: unknown;
  ollamaService?: unknown;
}) {
  return new ChatTurnService(
    {} as never,
    {} as never,
    (overrides.messageService ?? {}) as never,
    (overrides.ollamaService ?? {}) as never,
    (overrides.threadService ?? {}) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
    {} as never,
  );
}

describe('ChatTurnService.summarizeThread', () => {
  it('names the thread with the served chat model rather than a hardcoded summarizer', async () => {
    const threadService = {
      findById: jest.fn(async () => ({ id: 'thread-1', name: null })),
      update: jest.fn(async () => undefined),
    };
    const messageService = {
      findByThreadId: jest.fn(async () => [
        { role: 'user', content: 'Plan dinner', model: 'Qwen3.8-27B-Uncensored' },
        { role: 'assistant', content: 'Here is a menu.', model: 'Qwen3.8-27B-Uncensored' },
      ]),
    };
    const ollamaService = {
      resolveModel: jest.fn(async (_ctx: unknown, opts: { requestedModel?: string }) => ({
        model: opts.requestedModel ?? 'fallback',
        enableThinking: false,
        enableTools: false,
      })),
      chat: jest.fn(async () => ({ message: { content: 'Dinner plans' } })),
    };

    const service = buildService({ threadService, messageService, ollamaService });

    await service.summarizeThread({ ownerId: 'user-1', threadId: 'thread-1' });

    expect(ollamaService.resolveModel).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({
        requestedModel: 'Qwen3.8-27B-Uncensored',
        enableThinking: false,
        enableTools: false,
      }),
    );
    expect(ollamaService.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ model: 'Qwen3.8-27B-Uncensored' }),
    );
    expect(threadService.update).toHaveBeenCalledWith(
      expect.anything(),
      'thread-1',
      expect.objectContaining({ name: 'Dinner Plans' }),
    );
  });

  it('still names the thread when history has no stored model id', async () => {
    const threadService = {
      findById: jest.fn(async () => ({ id: 'thread-1', name: null })),
      update: jest.fn(async () => undefined),
    };
    const messageService = {
      findByThreadId: jest.fn(async () => [{ role: 'user', content: 'Plan dinner' }]),
    };
    const ollamaService = {
      resolveModel: jest.fn(async () => ({
        model: 'Qwen3.8-27B-Uncensored',
        enableThinking: false,
        enableTools: false,
      })),
      chat: jest.fn(async () => ({ message: { content: 'Dinner plans' } })),
    };

    const service = buildService({ threadService, messageService, ollamaService });

    await service.summarizeThread({ ownerId: 'user-1', threadId: 'thread-1' });

    expect(ollamaService.resolveModel).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      expect.objectContaining({ enableThinking: false, enableTools: false }),
    );
    expect(ollamaService.chat).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ model: 'Qwen3.8-27B-Uncensored' }),
    );
  });

  it('keeps chat jobs ahead of default-priority inference and titles', () => {
    expect(INTERACTIVE_JOB_PRIORITY).toBeGreaterThan(DEFAULT_JOB_PRIORITY);
    expect(LLM_QUEUE_OPTIONS.localConcurrency).toBe(1);
    expect(LLM_QUEUE_OPTIONS.retryLimit).toBe(3);
  });
});
