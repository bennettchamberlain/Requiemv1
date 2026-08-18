import { useEffect, useState } from 'react';

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImportApi, useRunProgress } from './useImportApi';

/**
 * The hook must return a STABLE object.
 *
 * Every call on it is already a `useCallback`, but the object wrapping them was
 * a fresh literal each render. A caller with `[api]` in an effect then re-ran
 * that effect on every render — fetch, set state, re-render, fetch — and /import
 * hammered `/api/import/sources` and `/api/import/runs` as fast as the responses
 * came back. Nothing failed; it just would not stop.
 *
 * The reference test is the direct one, but the loop test is the one that
 * describes the symptom, so both are here.
 */

vi.mock('@/hooks', () => ({ useAuth: () => [{ authToken: 'test-token' }] }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })),
  );
});

describe('useImportApi', () => {
  it('returns the same object across renders', () => {
    const seen: unknown[] = [];

    function Probe({ tick }: { tick: number }) {
      const api = useImportApi();

      seen.push(api);

      return <span>{tick}</span>;
    }

    const { rerender } = render(<Probe tick={0} />);

    rerender(<Probe tick={1} />);
    rerender(<Probe tick={2} />);

    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen.every((entry) => entry === seen[0])).toBe(true);
  });

  it('does not re-fire an effect that depends on it', async () => {
    // The shape ImportPage uses: fetch on mount, store the result, and depend on
    // the whole api object. If that object churns, this never settles.
    let effectRuns = 0;

    function Consumer() {
      const api = useImportApi();
      const [, setLoaded] = useState<unknown[]>([]);

      useEffect(() => {
        effectRuns += 1;
        void api.listRuns().then(setLoaded);
      }, [api]);

      return null;
    }

    render(<Consumer />);

    await waitFor(() => expect(effectRuns).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(effectRuns).toBe(1);
  });
});

/**
 * Deselecting a run has to CLEAR it.
 *
 * The Close button on an opened import called its handler and set the active id
 * to null, and nothing happened: this hook returned the previous run forever, so
 * the page still had something to render. The component test asserted the
 * handler fired, which it did — the button was never the broken part.
 */
describe('useRunProgress', () => {
  function Probe({ runId }: { runId: string | null }) {
    const { run } = useRunProgress(runId);

    return <span data-testid="run">{run == null ? 'none' : run.id}</span>;
  }

  it('drops the run when the id goes null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 'run-1', status: 'completed', stages: [], percent: 100 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const { rerender } = render(<Probe runId="run-1" />);

    await waitFor(() => expect(screen.getByTestId('run')).toHaveTextContent('run-1'));

    rerender(<Probe runId={null} />);

    await waitFor(() => expect(screen.getByTestId('run')).toHaveTextContent('none'));
  });
});

/**
 * `uploadFile` is the one call in this file that does NOT go through
 * `fetchJson`/`fetch` — it needs upload-progress events, which `fetch` has no
 * hook for, so it drives a raw `XMLHttpRequest` by hand. That hand-rolled
 * event wiring (`onerror`, `ontimeout`, the status-code branch, the JSON
 * body-parsing fallback) is exactly the kind of code that looks right and
 * silently isn't, so it gets its own fake XHR rather than trusting fetch mocks
 * to stand in for it.
 */
describe('useImportApi uploadFile', () => {
  class FakeXHR {
    static instances: FakeXHR[] = [];

    method = '';

    url = '';

    headers: Record<string, string> = {};

    upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } =
      { onprogress: null };

    onerror: (() => void) | null = null;

    ontimeout: (() => void) | null = null;

    onload: (() => void) | null = null;

    status = 0;

    responseText = '';

    sentBody: FormData | null = null;

    constructor() {
      FakeXHR.instances.push(this);
    }

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }

    send(body: FormData) {
      this.sentBody = body;
    }
  }

  function useProbeApi() {
    let captured: ReturnType<typeof useImportApi> | null = null;

    function Probe() {
      captured = useImportApi();

      return null;
    }

    render(<Probe />);

    // The hook is memoized and authToken is fixed for this file, so the
    // effect-free render above already produced the stable object.
    return captured as unknown as ReturnType<typeof useImportApi>;
  }

  beforeEach(() => {
    FakeXHR.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
  });

  it('POSTs the file with the current auth header', () => {
    const api = useProbeApi();
    const file = new File(['bytes'], 'export.zip');

    void api.uploadFile(file);

    const [xhr] = FakeXHR.instances;

    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('/api/import/uploads');
    expect(xhr.headers.Authorization).toBe('Bearer test-token');
    expect(xhr.sentBody?.get('files')).toBe(file);
  });

  it('rejects with a network-error message when the request errors out', async () => {
    const api = useProbeApi();
    const promise = api.uploadFile(new File(['x'], 'a.zip'));

    FakeXHR.instances[0].onerror?.();

    await expect(promise).rejects.toThrow('Upload failed: network error');
  });

  it('rejects with a timeout message on ontimeout', async () => {
    const api = useProbeApi();
    const promise = api.uploadFile(new File(['x'], 'a.zip'));

    FakeXHR.instances[0].ontimeout?.();

    await expect(promise).rejects.toThrow('Upload failed: timed out');
  });

  it('surfaces the server-provided message on a non-2xx JSON response', async () => {
    const api = useProbeApi();
    const promise = api.uploadFile(new File(['x'], 'a.zip'));
    const xhr = FakeXHR.instances[0];

    xhr.status = 422;
    xhr.responseText = JSON.stringify({ message: 'Not enough disk space to unpack' });
    xhr.onload?.();

    await expect(promise).rejects.toThrow('Not enough disk space to unpack');
  });

  it('joins an array message body into one line', async () => {
    const api = useProbeApi();
    const promise = api.uploadFile(new File(['x'], 'a.zip'));
    const xhr = FakeXHR.instances[0];

    xhr.status = 400;
    xhr.responseText = JSON.stringify({ message: ['name is required', 'file is required'] });
    xhr.onload?.();

    await expect(promise).rejects.toThrow('name is required, file is required');
  });

  it('falls back to a status-code message when the failure body is not JSON', async () => {
    const api = useProbeApi();
    const promise = api.uploadFile(new File(['x'], 'a.zip'));
    const xhr = FakeXHR.instances[0];

    xhr.status = 500;
    xhr.responseText = 'Internal Server Error';
    xhr.onload?.();

    await expect(promise).rejects.toThrow('Upload failed (500)');
  });

  it('resolves with the staged drop on a 2xx response', async () => {
    const api = useProbeApi();
    const promise = api.uploadFile(new File(['x'], 'a.zip'));
    const xhr = FakeXHR.instances[0];

    xhr.status = 201;
    xhr.responseText = JSON.stringify([{ dropId: 'drop-1', originalFilename: 'a.zip' }]);
    xhr.onload?.();

    await expect(promise).resolves.toEqual({ dropId: 'drop-1', originalFilename: 'a.zip' });
  });

  it('rejects when a 2xx response carries no drop at all', async () => {
    const api = useProbeApi();
    const promise = api.uploadFile(new File(['x'], 'a.zip'));
    const xhr = FakeXHR.instances[0];

    xhr.status = 200;
    xhr.responseText = '[]';
    xhr.onload?.();

    await expect(promise).rejects.toThrow('Nothing was uploaded');
  });

  it('reports byte progress as the upload streams', () => {
    const api = useProbeApi();
    const onProgress = vi.fn();

    void api.uploadFile(new File(['x'], 'a.zip'), onProgress);

    FakeXHR.instances[0].upload.onprogress?.({ lengthComputable: true, loaded: 512, total: 2048 });

    expect(onProgress).toHaveBeenCalledWith(512, 2048);
  });

  it('does not report progress when the event has no computable length', () => {
    const api = useProbeApi();
    const onProgress = vi.fn();

    void api.uploadFile(new File(['x'], 'a.zip'), onProgress);

    FakeXHR.instances[0].upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });

    expect(onProgress).not.toHaveBeenCalled();
  });
});
