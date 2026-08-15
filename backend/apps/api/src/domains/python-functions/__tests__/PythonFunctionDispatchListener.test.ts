import type { LoggerService } from '@ci/common/logging';
import type { Acknowledgement } from '@ci/domains/events';

import { PythonFunctionDispatchListener } from '../listeners/PythonFunctionDispatchListener';

const logger = { setContext() {}, log() {}, warn() {}, error() {} } as unknown as LoggerService;

const payload = {
  target: 'summary' as const,
  function: 'hourly_summary',
  args: { user_id: 'user-1' },
  userId: 'user-1',
  jobId: 'job-1',
};

function makeAck(): Acknowledgement {
  return { done: jest.fn(), fail: jest.fn(), defer: jest.fn() };
}

describe('PythonFunctionDispatchListener', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs the run to /functions/run and defers the job on 2xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });

    global.fetch = fetchMock as unknown as typeof fetch;

    const listener = new PythonFunctionDispatchListener(logger);
    const ack = makeAck();

    await listener.dispatchSummary(payload, ack);

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toMatch(/\/functions\/run$/);
    expect(JSON.parse(String(init.body))).toEqual({
      function: 'hourly_summary',
      args: { user_id: 'user-1' },
      job_id: 'job-1',
      queue: 'py-fn-summary',
    });

    expect(ack.defer).toHaveBeenCalledTimes(1);
    expect(ack.fail).not.toHaveBeenCalled();
    expect(ack.done).not.toHaveBeenCalled();
  });

  it('fails the job (for pg-boss retry) when the runner rejects the dispatch', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('pool full'),
    }) as unknown as typeof fetch;

    const listener = new PythonFunctionDispatchListener(logger);
    const ack = makeAck();

    await listener.dispatchSummary(payload, ack);

    expect(ack.fail).toHaveBeenCalledTimes(1);
    expect(ack.defer).not.toHaveBeenCalled();
  });

  it('fails the job when the runner is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const listener = new PythonFunctionDispatchListener(logger);
    const ack = makeAck();

    await listener.dispatchHbpe({ ...payload, target: 'hbpe', function: 'nightly' }, ack);

    expect(ack.fail).toHaveBeenCalledTimes(1);
    expect(ack.defer).not.toHaveBeenCalled();
  });
});
