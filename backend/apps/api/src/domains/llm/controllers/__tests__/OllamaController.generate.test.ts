import { ConflictException } from '@nestjs/common';

import { ChatGenerationBroker } from '../../services/ChatGenerationBroker';
import { OllamaController } from '../OllamaController';

function mockResponse() {
  const closeHandlers: Array<() => void> = [];

  const res = {
    socket: { setNoDelay: jest.fn() },
    writeHead: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
    status: jest.fn().mockReturnThis(),
    on: jest.fn((event: string, handler: () => void) => {
      if (event === 'close') {
        closeHandlers.push(handler);
      }
    }),
    writableEnded: false,
  };

  return { res, closeHandlers };
}

describe('OllamaController generate attach', () => {
  const context = { userId: 'user-1' };
  const thread = { id: 'thread-1', generationStatus: 'idle', name: null };

  function buildController(overrides: Record<string, unknown> = {}) {
    const broker = new ChatGenerationBroker();
    const messageService = {
      create: jest
        .fn()
        .mockResolvedValueOnce({ id: 'user-msg' })
        .mockResolvedValueOnce({ id: 'assistant-msg' }),
    };
    const ollamaService = {
      resolveModel: jest.fn(async () => ({ model: 'Qwen3.8-27B-Uncensored' })),
    };
    const threadService = {
      findById: jest.fn(async () => thread),
      create: jest.fn(async () => thread),
    };
    const chatTurnService = {
      setGenerationStatus: jest.fn(async () => undefined),
      enqueueGenerate: jest.fn(async () => ['job-1']),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), error: jest.fn() };
    const controller = new OllamaController(
      (overrides.messageService ?? messageService) as never,
      (overrides.ollamaService ?? ollamaService) as never,
      (overrides.threadService ?? threadService) as never,
      (overrides.broker ?? broker) as never,
      (overrides.chatTurnService ?? chatTurnService) as never,
      logger as never,
    );

    return { controller, broker, chatTurnService, threadService };
  }

  it('enqueues a chat.generate job and does not abort when the SSE client disconnects', async () => {
    const { controller, broker, chatTurnService } = buildController();
    const { res, closeHandlers } = mockResponse();

    await controller.generate(
      context as never,
      {
        prompt: 'hello',
        threadId: 'thread-1',
        enableTools: true,
        enableThinking: false,
      } as never,
      res as never,
      {} as never,
    );

    expect(chatTurnService.enqueueGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'user-1',
        threadId: 'thread-1',
        promptMessageId: 'user-msg',
        assistantMessageId: 'assistant-msg',
      }),
    );

    const signal = broker.signal('thread-1');
    closeHandlers.forEach((handler) => handler());
    expect(signal.aborted).toBe(false);
  });

  it('rejects a second generate while the thread is already queued', async () => {
    const { controller } = buildController({
      threadService: {
        findById: jest.fn(async () => ({ ...thread, generationStatus: 'queued' })),
      },
    });
    const { res } = mockResponse();

    await expect(
      controller.generate(
        context as never,
        { prompt: 'hello', threadId: 'thread-1' } as never,
        res as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('cancel aborts the in-process generation without requiring the viewer to stay attached', async () => {
    const { controller, broker, chatTurnService } = buildController({
      threadService: {
        findById: jest.fn(async () => ({ ...thread, generationStatus: 'running' })),
      },
    });
    broker.ensure('thread-1');
    const signal = broker.signal('thread-1');

    await controller.cancel(context as never, 'thread-1');

    expect(signal.aborted).toBe(true);
    expect(chatTurnService.setGenerationStatus).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
      'thread-1',
      'idle',
    );
  });

  it('GET stream returns 204 when the thread is idle and nothing is in flight', async () => {
    const { controller } = buildController();
    const { res } = mockResponse();

    await controller.stream(context as never, 'thread-1', res as never);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
  });
});
