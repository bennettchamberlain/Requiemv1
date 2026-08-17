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
