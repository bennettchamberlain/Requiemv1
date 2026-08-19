import { Channel } from '@ci/common/rpc';

import { ChatGenerationBroker } from '../ChatGenerationBroker';

function mockResponse() {
  const chunks: Buffer[] = [];
  let ended = false;
  const closeHandlers: Array<() => void> = [];

  const res = {
    socket: { setNoDelay: jest.fn() },
    writeHead: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn((buf: Buffer) => {
      chunks.push(Buffer.from(buf));
    }),
    end: jest.fn(() => {
      ended = true;
    }),
    on: jest.fn((event: string, handler: () => void) => {
      if (event === 'close') {
        closeHandlers.push(handler);
      }
    }),
    get writableEnded() {
      return ended;
    },
  };

  return { res, chunks, closeHandlers, isEnded: () => ended };
}

describe('ChatGenerationBroker', () => {
  it('does not abort the generation signal when an HTTP viewer disconnects', () => {
    const broker = new ChatGenerationBroker();
    const signal = broker.signal('thread-1');
    const { res, closeHandlers } = mockResponse();

    broker.pipeToResponse(res as never, 'thread-1');
    closeHandlers.forEach((handler) => handler());

    expect(signal.aborted).toBe(false);
  });

  it('ends attached viewers on abort without deleting the worker signal', () => {
    const broker = new ChatGenerationBroker();
    const signal = broker.signal('thread-1');
    const { res } = mockResponse();

    broker.pipeToResponse(res as never, 'thread-1');
    broker.abort('thread-1');

    expect(signal.aborted).toBe(true);
    expect(res.end).toHaveBeenCalled();
    expect(broker.has('thread-1')).toBe(true);
  });

  it('replays snapshot then live chunks to a late viewer', () => {
    const broker = new ChatGenerationBroker();
    broker.ensure('thread-1');
    broker.publish('thread-1', { channel: Channel.TEXT, text: 'Hel' });

    const { res, chunks } = mockResponse();
    broker.pipeToResponse(res as never, 'thread-1');

    expect(chunks.length).toBeGreaterThan(0);

    broker.publish('thread-1', { channel: Channel.TEXT, text: 'lo' });
    broker.complete('thread-1');

    expect(res.end).toHaveBeenCalled();
  });
});
