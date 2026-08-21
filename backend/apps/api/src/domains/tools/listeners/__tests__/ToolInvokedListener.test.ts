import { EventListenerRegistry } from '@ci/domains/events';

import { ToolInvokedEvent, type ToolInvokedPayload } from '../../events';
import { ToolInvokedListener } from '../ToolInvokedListener';

function makeLogger() {
  return {
    setContext: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function makePayload(overrides: Partial<ToolInvokedPayload> = {}): ToolInvokedPayload {
  return {
    intent: 'memory.recall',
    tool: 'memory_recall',
    domain: 'memory',
    userId: 'user-1',
    success: true,
    durationMs: 42,
    access: 'read',
    external: false,
    ...overrides,
  };
}

describe('ToolInvokedListener', () => {
  it('registers a listener on the `telemetry` queue for tool.invoked, so send() routes there instead of dropping it', () => {
    // The @OnEvent decorator runs at class-definition time — importing the class above
    // already registered it. This is the class's headline claim: that its mere existence
    // is what keeps `tool.invoked` from being an orphaned send() with nowhere to land.
    expect(EventListenerRegistry.getQueuesFor(ToolInvokedEvent)).toEqual(new Set(['telemetry']));
  });

  it('records the full invocation payload, not a hand-picked subset of it', () => {
    const logger = makeLogger();
    const listener = new ToolInvokedListener(logger);

    listener.handleToolInvoked(makePayload());

    expect(logger.debug).toHaveBeenCalledWith('tool.invoked', {
      intent: 'memory.recall',
      tool: 'memory_recall',
      domain: 'memory',
      access: 'read',
      external: false,
      success: true,
      durationMs: 42,
      userId: 'user-1',
    });
  });

  it('records a failed invocation the same way a successful one is recorded', () => {
    const logger = makeLogger();
    const listener = new ToolInvokedListener(logger);

    listener.handleToolInvoked(makePayload({ success: false, tool: 'memory_forget' }));

    expect(logger.debug).toHaveBeenCalledWith(
      'tool.invoked',
      expect.objectContaining({ success: false, tool: 'memory_forget' }),
    );
  });

  it('does not throw when the optional fields (userId, durationMs) are absent', () => {
    const logger = makeLogger();
    const listener = new ToolInvokedListener(logger);

    expect(() =>
      listener.handleToolInvoked(makePayload({ userId: undefined, durationMs: undefined })),
    ).not.toThrow();

    expect(logger.debug).toHaveBeenCalledWith(
      'tool.invoked',
      expect.objectContaining({ userId: undefined, durationMs: undefined }),
    );
  });
});
