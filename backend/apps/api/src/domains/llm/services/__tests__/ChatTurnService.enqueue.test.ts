import { INTERACTIVE_JOB_PRIORITY } from '@ci/domains/events';

import { LLM_QUEUE } from '../../constants';
import { ChatGenerateEvent } from '../../events';
import { ChatTurnService } from '../ChatTurnService';

describe('ChatTurnService.enqueueGenerate', () => {
  it('sends chat.generate onto the llm queue at interactive priority with a per-thread singleton', async () => {
    const eventService = { send: jest.fn(async () => ['job-1']) };
    const service = new ChatTurnService(
      eventService as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { setContext: jest.fn() } as never,
      {} as never,
    );

    await service.enqueueGenerate({
      ownerId: 'user-1',
      threadId: 'thread-1',
      promptMessageId: 'm1',
      assistantMessageId: 'm2',
      model: 'Qwen3.8-27B-Uncensored',
      enableTools: true,
      enableThinking: false,
      capability: 'full',
    });

    expect(eventService.send).toHaveBeenCalledWith(
      ChatGenerateEvent,
      expect.objectContaining({ threadId: 'thread-1', model: 'Qwen3.8-27B-Uncensored' }),
      {
        queue: LLM_QUEUE,
        priority: INTERACTIVE_JOB_PRIORITY,
        singletonKey: 'chat-generate:thread-1',
      },
    );
  });
});
