import { ChatGenerateListener } from '../ChatGenerateListener';

describe('ChatGenerateListener', () => {
  it('runs the chat turn and swallows title-job failures so retries are not burned on naming', async () => {
    const chatTurnService = {
      execute: jest.fn(async () => undefined),
      summarizeThread: jest.fn(async () => {
        throw new Error('model down');
      }),
    };
    const logger = { setContext: jest.fn(), error: jest.fn() };
    const listener = new ChatGenerateListener(chatTurnService as never, logger as never);

    await listener.handleGenerate({
      ownerId: 'user-1',
      threadId: 'thread-1',
      promptMessageId: 'm1',
      assistantMessageId: 'm2',
      model: 'Qwen3.8-27B-Uncensored',
      enableTools: false,
      enableThinking: false,
      capability: 'full',
    });

    expect(chatTurnService.execute).toHaveBeenCalledTimes(1);

    await listener.handleSummarization({
      ownerId: 'user-1',
      threadId: 'thread-1',
    } as never);

    expect(chatTurnService.summarizeThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-1' }),
    );
    expect(logger.error).toHaveBeenCalled();
  });
});
