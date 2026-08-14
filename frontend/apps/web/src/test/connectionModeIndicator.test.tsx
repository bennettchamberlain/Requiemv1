/**
 * What the connection chip actually tells the user, driven through the real
 * provider and a real (faked) health endpoint.
 *
 * `connectionMode.test.ts` covers the resolver in isolation — given a set of
 * probes, the right mode comes out. What is asserted here is the part a user
 * reads off the screen, and both cases below were wrong in the same
 * deployment: an appliance reached over a Cloudflare tunnel answers
 * /api/health in ~650ms, which the old single 500ms probe budget aborted, so
 * the chip claimed "Not synced yet" against a server the rest of the app was
 * using without trouble — and, since the mode was resolved once at mount, it
 * kept claiming it for the life of the page.
 */

import { setApiKey } from '@ci/common/src/utils/apiAuth';
import { setApiBaseUrl } from '@ci/common/src/utils/apiBase';
import { ConnectionModeProvider } from '@ci/common/src/utils/connectionMode';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConnectionModeIndicator } from '@/components/ConnectionModeIndicator';

/** Slower than an on-device sidecar should ever be — the tunnel's real latency. */
const TUNNEL_LATENCY_MS = 650;

function okResponse(body: unknown = { status: 'ok' }): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
}

/**
 * A healthy server that takes `latencyMs` to answer, and that honours an abort
 * the way real `fetch` does. Honouring it is the whole point: fetchJson's
 * timeout has no race of its own — it aborts the request and lets the
 * rejection propagate — so a stand-in that ignores the signal answers late and
 * succeeds under any budget, and the test asserts nothing.
 */
function slowServer(latencyMs: number) {
  return vi.fn(
    (_input: RequestInfo, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(okResponse()), latencyMs);

        init?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
  );
}

function renderIndicator() {
  return render(
    <ConnectionModeProvider args={[]}>
      <ConnectionModeIndicator />
    </ConnectionModeProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setApiBaseUrl('');
  setApiKey(null);
});

describe('ConnectionModeIndicator', () => {
  it('reports "Connected" for a remote that answers slower than an on-device server would', async () => {
    vi.stubGlobal('fetch', slowServer(TUNNEL_LATENCY_MS));

    renderIndicator();

    // "Connected" is the one mode kept to just the dot, so the label is present
    // for screen readers only — the chip is found by its accessible name.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Connected' })).toBeInTheDocument());
    expect(screen.queryByText('Not synced yet')).not.toBeInTheDocument();
  });

  it('renders nothing until the first probe settles, rather than asserting "Not synced yet" on load', async () => {
    let release: (() => void) | undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });

        return okResponse();
      }),
    );

    const { container } = renderIndicator();

    // The pre-probe mode is "fresh"; showing it would tell the user the app has
    // never synced, moments before the health check says otherwise.
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Not synced yet')).not.toBeInTheDocument();

    release?.();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connected' })).toBeInTheDocument());
  });

  it('reports "Not synced yet" once a genuinely unreachable server has been probed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    renderIndicator();

    await waitFor(() => expect(screen.getByText('Not synced yet')).toBeInTheDocument());
  });
});
