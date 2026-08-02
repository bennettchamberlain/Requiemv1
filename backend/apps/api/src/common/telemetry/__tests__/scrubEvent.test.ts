import type { ErrorEvent } from '@sentry/nestjs';

import { scrubEvent, scrubString } from '../scrubEvent';

describe('scrubString', () => {
  it('redacts bearer tokens', () => {
    expect(scrubString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).toContain('[Filtered]');
    expect(scrubString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def')).not.toContain(
      'eyJhbGciOiJIUzI1NiJ9',
    );
  });

  it('redacts labelled secrets', () => {
    expect(scrubString('api_key=sk-live-1234567890')).not.toContain('sk-live-1234567890');
    expect(scrubString('password: hunter2')).not.toContain('hunter2');
    expect(scrubString('{"token":"abcdef123456"}')).not.toContain('abcdef123456');
  });

  it('redacts tailscale auth keys', () => {
    expect(scrubString('tskey-auth-abc123-def456')).toBe('[Filtered]');
  });

  it('redacts credentials embedded in connection URLs', () => {
    const scrubbed = scrubString('postgres://ci:pgadmin_s3cure@db:5432/companion');

    expect(scrubbed).not.toContain('pgadmin_s3cure');
    expect(scrubbed).toContain('[Filtered]');
  });

  it('collapses home directories, which leak account names', () => {
    expect(scrubString('/Users/liam/devel/ci/file.ts')).toBe('~/devel/ci/file.ts');
    expect(scrubString('/home/ci/data/timeline.db')).toBe('~/data/timeline.db');
    expect(scrubString('C:\\Users\\liam\\app.log')).toBe('~\\app.log');
  });

  it('truncates oversized strings', () => {
    const scrubbed = scrubString('a'.repeat(9000));

    expect(scrubbed).toHaveLength(8000 + '… [truncated]'.length);
    expect(scrubbed.endsWith('… [truncated]')).toBe(true);
  });

  it('leaves ordinary text alone', () => {
    expect(scrubString('Cannot read properties of undefined (reading "id")')).toBe(
      'Cannot read properties of undefined (reading "id")',
    );
  });
});

describe('scrubEvent', () => {
  it('scrubs the message and exception values', () => {
    const event = {
      message: 'failed for /Users/liam/notes',
      exception: { values: [{ value: 'Bearer secrettokenvalue rejected' }] },
    } as ErrorEvent;

    const scrubbed = scrubEvent(event)!;

    expect(scrubbed.message).toBe('failed for ~/notes');
    expect(scrubbed.exception!.values![0]!.value).not.toContain('secrettokenvalue');
  });

  it('filters sensitive keys in extra, at any depth', () => {
    const event = {
      extra: { outer: { password: 'hunter2', note: '/home/ci/x' }, dsn: 'https://k@o1.ingest.sentry.io/2' },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event)!;
    const extra = scrubbed.extra as { outer: { password: string; note: string }; dsn: string };

    expect(extra.outer.password).toBe('[Filtered]');
    expect(extra.outer.note).toBe('~/x');
    expect(extra.dsn).toBe('[Filtered]');
  });

  it('drops request cookies, body and query string', () => {
    const event = {
      request: {
        cookies: { sessionToken: 'abc' },
        data: { query: 'what did I do last summer' },
        query_string: 'q=private+search',
        headers: { authorization: 'Bearer abc', 'user-agent': 'curl/8' },
      },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event)!;

    expect(scrubbed.request!.cookies).toBeUndefined();
    expect(scrubbed.request!.data).toBeUndefined();
    expect(scrubbed.request!.query_string).toBe('[Filtered]');
    expect(scrubbed.request!.headers!.authorization).toBe('[Filtered]');
    expect(scrubbed.request!.headers!['user-agent']).toBe('curl/8');
  });

  it('scrubs breadcrumb messages and data', () => {
    const event = {
      breadcrumbs: [{ message: 'GET /Users/liam', data: { token: 'abc123' } }],
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event)!;

    expect(scrubbed.breadcrumbs![0]!.message).toBe('GET ~');
    expect(scrubbed.breadcrumbs![0]!.data!.token).toBe('[Filtered]');
  });

  it('survives a cyclic extra payload', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;

    expect(() => scrubEvent({ extra: cyclic } as unknown as ErrorEvent)).not.toThrow();
  });

  it('passes through an event with nothing to scrub', () => {
    const event = { message: 'plain failure' } as ErrorEvent;

    expect(scrubEvent(event)).toEqual({ message: 'plain failure' });
  });
});

describe('scrubEvent — leaks confirmed by adversarial review', () => {
  it('strips the query string from request.url, not just query_string', () => {
    // The SDK builds request.url from req.url, which on a Node server is
    // path+query — so filtering query_string alone redacted nothing.
    const event = {
      request: {
        url: 'https://memory.local/api/graph/search?query=oncologist&people=Dr.%20Chen',
        query_string: 'query=oncologist',
      },
    } as unknown as ErrorEvent;

    const scrubbed = scrubEvent(event)!;

    expect(scrubbed.request!.url).toBe('https://memory.local/api/graph/search');
    expect(scrubbed.request!.query_string).toBe('[Filtered]');
  });

  it('strips the query string from the referer header', () => {
    const event = {
      request: { headers: { Referer: 'https://memory.local/memory?search=divorce%20lawyer' } },
    } as unknown as ErrorEvent;

    expect(scrubEvent(event)!.request!.headers!.Referer).toBe('https://memory.local/memory');
  });

  it('filters the hyphenated x-api-key header', () => {
    const event = { request: { headers: { 'x-api-key': 'ci_live_abcdef123456' } } } as unknown as ErrorEvent;

    expect(scrubEvent(event)!.request!.headers!['x-api-key']).toBe('[Filtered]');
  });

  it('removes the machine hostname', () => {
    const event = { server_name: 'MacBook-Pro-2.local' } as unknown as ErrorEvent;

    expect(scrubEvent(event)!.server_name).toBeUndefined();
  });

  it('scrubs stack frame paths and captured locals', () => {
    const event = {
      exception: {
        values: [
          {
            value: 'boom',
            stacktrace: {
              frames: [
                {
                  filename: '/Users/liam/devel/ci/x.ts',
                  abs_path: '/Users/liam/devel/ci/x.ts',
                  vars: { noteText: '/home/ci/journal', password: 'hunter2' },
                },
              ],
            },
          },
        ],
      },
    } as unknown as ErrorEvent;

    const frame = scrubEvent(event)!.exception!.values![0]!.stacktrace!.frames![0]!;

    expect(frame.filename).toBe('~/devel/ci/x.ts');
    expect(frame.abs_path).toBe('~/devel/ci/x.ts');
    expect((frame.vars as Record<string, unknown>).noteText).toBe('~/journal');
    expect((frame.vars as Record<string, unknown>).password).toBe('[Filtered]');
  });

  it('collapses Windows home paths in both slash styles', () => {
    // Regression: the macOS pattern used to match inside `C:/Users/…` first,
    // leaving a stranded `C:~/…`.
    expect(scrubString('C:\\Users\\liam\\app.log')).toBe('~\\app.log');
    expect(scrubString('C:/Users/liam/AppData/ci')).toBe('~/AppData/ci');
  });
});
