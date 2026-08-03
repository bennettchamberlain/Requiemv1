import type { ErrorEvent } from '@sentry/react';
import { describe, expect, it } from 'vitest';

import { scrubBrowserEvent, scrubString, scrubUrl, shouldDropEvent } from './telemetry';
import { MAX_STRING_LENGTH, SCRUB_CASES } from './telemetryScrubFixtures';

const event = (partial: Partial<ErrorEvent>) => partial as ErrorEvent;

describe('scrubUrl', () => {
  it('drops the query string and hash', () => {
    expect(scrubUrl('https://ci-server.localhost/search?q=my+private+note#results')).toBe(
      'https://ci-server.localhost/search',
    );
  });

  it('keeps a bare path intact', () => {
    expect(scrubUrl('/memories/2026')).toBe('/memories/2026');
  });

  it('leaves the origin and path exactly as written', () => {
    expect(scrubUrl('https://ci-server.localhost/a b/c')).toBe('https://ci-server.localhost/a b/c');
  });

  it('handles unparseable input without throwing', () => {
    expect(scrubUrl('::not a url::?q=secret')).toBe('::not a url::');
  });
});

describe('shouldDropEvent', () => {
  it.each([
    'Loading chunk 42 failed',
    'Failed to fetch dynamically imported module: /assets/x.js',
    'ResizeObserver loop completed with undelivered notifications',
  ])('drops known noise: %s', (message) => {
    expect(shouldDropEvent(event({ message }))).toBe(true);
  });

  it('keeps a real application error', () => {
    expect(shouldDropEvent(event({ message: 'Cannot read properties of undefined' }))).toBe(false);
  });

  it('inspects exception values, not just the message', () => {
    expect(shouldDropEvent(event({ exception: { values: [{ value: 'Loading chunk 7 failed' }] } }))).toBe(
      true,
    );
  });
});

describe('scrubBrowserEvent', () => {
  it('returns null for dropped noise', () => {
    expect(scrubBrowserEvent(event({ message: 'Loading chunk 3 failed' }))).toBeNull();
  });

  it('scrubs the request url and removes cookies and query string', () => {
    const scrubbed = scrubBrowserEvent(
      event({
        message: 'boom',
        request: {
          url: 'https://ci-server.localhost/search?q=private',
          cookies: { sessionToken: 'abc' },
          query_string: 'q=private',
        },
      }),
    );

    expect(scrubbed!.request!.url).toBe('https://ci-server.localhost/search');
    expect(scrubbed!.request!.cookies).toBeUndefined();
    expect(scrubbed!.request!.query_string).toBeUndefined();
  });

  it('scrubs navigation breadcrumbs', () => {
    const scrubbed = scrubBrowserEvent(
      event({
        message: 'boom',
        breadcrumbs: [{ category: 'navigation', data: { from: '/a?q=x', to: '/b?q=y' } }],
      }),
    );

    expect(scrubbed!.breadcrumbs![0]!.data).toEqual({ from: '/a', to: '/b' });
  });

  it('passes a clean event through untouched', () => {
    expect(scrubBrowserEvent(event({ message: 'real failure' }))).toEqual({ message: 'real failure' });
  });
});

describe('scrubBrowserEvent — leaks confirmed by adversarial review', () => {
  it('scrubs fetch/xhr breadcrumb urls, which carry the memory search', () => {
    const scrubbed = scrubBrowserEvent(
      event({
        message: 'boom',
        breadcrumbs: [
          { category: 'fetch', data: { url: '/api/graph/search?query=divorce+lawyer&people=alice' } },
        ],
      }),
    );

    expect(scrubbed!.breadcrumbs![0]!.data!.url).toBe('/api/graph/search');
  });

  it('scrubs console breadcrumb message and arguments', () => {
    const scrubbed = scrubBrowserEvent(
      event({
        message: 'boom',
        breadcrumbs: [
          {
            category: 'console',
            message: 'token=abc123456 at /Users/liam/x',
            data: { arguments: ['Bearer abcdefghijkl'] },
          },
        ],
      }),
    );
    const crumb = scrubbed!.breadcrumbs![0]!;

    expect(crumb.message).not.toContain('abc123456');
    expect(crumb.message).toContain('~/x');
    expect(JSON.stringify(crumb.data!.arguments)).not.toContain('abcdefghijkl');
  });

  it('scrubs the referer header put there by httpContextIntegration', () => {
    const scrubbed = scrubBrowserEvent(
      event({ message: 'boom', request: { headers: { Referer: 'https://x/memory?search=oncology' } } }),
    );

    expect(scrubbed!.request!.headers!.Referer).toBe('https://x/memory');
  });

  it('applies the shared secret and home-path rules the browser was missing', () => {
    const scrubbed = scrubBrowserEvent(
      event({
        message: 'failed at /Users/liam/notes with api_key=sk-live-123456',
        exception: { values: [{ value: 'Bearer eyJhbGciOiJIUzI1NiJ9.a.b rejected' }] },
        extra: { password: 'hunter2' },
      }),
    );

    expect(scrubbed!.message).toContain('~/notes');
    expect(scrubbed!.message).not.toContain('sk-live-123456');
    expect(scrubbed!.exception!.values![0]!.value).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect((scrubbed!.extra as Record<string, unknown>).password).toBe('[Filtered]');
  });
});

describe('shared scrub fixtures — parity with the backend scrubber', () => {
  // The identical list lives at
  // backend/apps/api/src/common/telemetry/scrubFixtures.ts and is run by that
  // suite too. The browser copy originally shipped with none of these rules.
  it.each(SCRUB_CASES.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const actual = scrubString(testCase.input);

    if (testCase.expected !== undefined) {
      expect(actual).toBe(testCase.expected);
    }

    for (const forbidden of testCase.mustNotContain ?? []) {
      expect(actual).not.toContain(forbidden);
    }
  });

  it('truncates at the shared limit', () => {
    expect(scrubString('a'.repeat(MAX_STRING_LENGTH + 1000))).toHaveLength(
      MAX_STRING_LENGTH + '… [truncated]'.length,
    );
  });

  it('the two fixture files have not drifted', async () => {
    const [fs, path] = await Promise.all([import('node:fs/promises'), import('node:path')]);
    const here = path.resolve(__dirname, 'telemetryScrubFixtures.ts');
    const backend = path.resolve(
      __dirname,
      '../../../../../backend/apps/api/src/common/telemetry/scrubFixtures.ts',
    );

    const [a, b] = await Promise.all([fs.readFile(here, 'utf8'), fs.readFile(backend, 'utf8')]);

    // The copy carries one extra header comment; the case list must match.
    const cases = (source: string) => source.slice(source.indexOf('export interface ScrubCase'));

    expect(cases(a)).toBe(cases(b));
  });
});
