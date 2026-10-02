import type { Acknowledgement } from '@ci/domains/events';

import { ChatGenerateListener } from '../ChatGenerateListener';

const titlePayload = { ownerId: 'user-1', threadId: 'thread-1' } as never;

function makeListener(summarizeThread: jest.Mock = jest.fn(async () => undefined)) {
  const chatTurnService = { execute: jest.fn(async () => undefined), summarizeThread };
  const logger = { setContext: jest.fn(), error: jest.fn() };
  const listener = new ChatGenerateListener(chatTurnService as never, logger as never);

  return { listener, chatTurnService, logger };
}

function makeAck(): Acknowledgement {
  return { jobId: 'job-1', done: jest.fn(), fail: jest.fn(), defer: jest.fn() };
}

/** How the queue worker drives a decorated listener: payload plus an acknowledgement to settle. */
function withAck(listener: ChatGenerateListener) {
  return listener.handleSummarization.bind(listener) as unknown as (
    payload: unknown,
    ack: Acknowledgement,
  ) => Promise<void>;
}

describe('ChatGenerateListener', () => {
  it('runs the chat turn', async () => {
    const { listener, chatTurnService } = makeListener();

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
  });

  /**
   * A title that fails (the model busy or timing out under load, Ollama down) used to be swallowed here "so
   * retries are not burned on naming" — back when titles shared the interactive slot and a retried title held up a
   * person's chat turn. On llm-background that cost is gone (the queue yields to chat), and swallowing meant a
   * title that failed once was never retried: nothing re-enqueues it until the thread's NEXT turn, so a one-turn
   * thread stayed untitled for good. The error has to reach the queue, which retries it a bounded number of times
   * and then dead-letters it.
   */
  describe('the title job', () => {
    it('names the thread from the payload it was given', async () => {
      const { listener, chatTurnService } = makeListener();
      const ack = makeAck();

      await withAck(listener)(titlePayload, ack);

      expect(chatTurnService.summarizeThread).toHaveBeenCalledWith(
        expect.objectContaining({ ownerId: 'user-1', threadId: 'thread-1' }),
      );
      expect(ack.done).toHaveBeenCalledTimes(1);
      expect(ack.fail).not.toHaveBeenCalled();
    });

    it('fails the job when naming throws, so the queue retries it instead of marking it done', async () => {
      const { listener } = makeListener(
        jest.fn(async () => {
          throw new Error('model down');
        }),
      );
      const ack = makeAck();

      await withAck(listener)(titlePayload, ack);

      expect(ack.fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'model down' }));
      expect(ack.done).not.toHaveBeenCalled();
    });

    it('rejects a direct call as well, rather than resolving over the failure', async () => {
      const { listener } = makeListener(
        jest.fn(async () => {
          throw new Error('model down');
        }),
      );

      await expect(listener.handleSummarization(titlePayload)).rejects.toThrow('model down');
    });
  });
});
