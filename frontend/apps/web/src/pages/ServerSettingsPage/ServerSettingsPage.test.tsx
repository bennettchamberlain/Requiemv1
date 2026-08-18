import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ServerSettingsPage } from './ServerSettingsPage';

/**
 * Native-only "point the app at your Memory Server" screen. A bug here means the app
 * silently talks to the wrong origin — so what matters is: the entered URL is
 * health-checked against `<origin>/api/health` (never against the origin the app is
 * ALREADY configured for), a genuinely reachable origin is persisted and the user is
 * handed off, and an unreachable/invalid one is neither persisted nor silently accepted.
 */

const navigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();

  return { ...actual, useNavigate: () => navigate };
});

const h = vi.hoisted(() => ({
  apiBaseUrl: '',
  persistApiBaseUrl: vi.fn(),
}));

vi.mock('@ci/common', () => ({
  getApiBaseUrl: () => h.apiBaseUrl,
  buildApiUrl: (path: string) => `${h.apiBaseUrl}${path}`,
  persistApiBaseUrl: h.persistApiBaseUrl,
}));

function fillUrl(value: string) {
  fireEvent.change(screen.getByLabelText('Memory Server URL'), { target: { value } });
}

function submit() {
  // Dispatch the `submit` event directly rather than clicking the submit button: the
  // input is `type="url"`, and jsdom (like a real browser) gates a *button-triggered*
  // submission behind its own native constraint validation — a value like "not a url"
  // would never even reach `onSubmit`, silently testing nothing. Submitting the form
  // directly exercises this component's own validation in `toOrigin`, which is what
  // these tests are actually about.
  const form = screen.getByRole('button', { name: /test & connect/i }).closest('form');

  if (!form) {
    throw new Error('submit button is not inside a form');
  }

  fireEvent.submit(form);
}

beforeEach(() => {
  h.apiBaseUrl = '';
  h.persistApiBaseUrl.mockReset();
  navigate.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ServerSettingsPage', () => {
  it('shows the currently configured origin as a hint', () => {
    h.apiBaseUrl = 'https://old.example.com';

    render(<ServerSettingsPage />);

    expect(screen.getByText(/currently targeting: https:\/\/old\.example\.com\/api/i)).toBeInTheDocument();
  });

  it('rejects an unparseable URL before ever making a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<ServerSettingsPage />);
    fillUrl('not a url');
    submit();

    expect(await screen.findByText(/enter a full memory server url/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.persistApiBaseUrl).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('rejects a non-http(s) URL (e.g. a scheme mismatch) without persisting it', async () => {
    render(<ServerSettingsPage />);
    fillUrl('ftp://memory.example.com');
    submit();

    expect(await screen.findByText(/enter a full memory server url/i)).toBeInTheDocument();
    expect(h.persistApiBaseUrl).not.toHaveBeenCalled();
  });

  it('health-checks the CANDIDATE origin (not the already-configured one) before persisting', async () => {
    h.apiBaseUrl = 'https://old.example.com';

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://new.example.com/api/health');

      return new Response(null, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ServerSettingsPage />);
    fillUrl('https://new.example.com/some/path?x=1');
    submit();

    await waitFor(() => expect(h.persistApiBaseUrl).toHaveBeenCalledWith('https://new.example.com'));
    // Path/query/hash are stripped — only the clean origin is ever persisted.
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('reports the server status code on an unhealthy response and does not persist or navigate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    );

    render(<ServerSettingsPage />);
    fillUrl('https://down.example.com');
    submit();

    expect(await screen.findByText(/could not reach your companion memory/i)).toBeInTheDocument();
    expect(h.persistApiBaseUrl).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('reports a timeout distinctly from a network/connection error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }),
    );
    vi.useFakeTimers();

    render(<ServerSettingsPage />);
    fillUrl('https://slow.example.com');
    submit();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    vi.useRealTimers();

    expect(await screen.findByText(/timed out/i)).toBeInTheDocument();
    expect(h.persistApiBaseUrl).not.toHaveBeenCalled();
  });

  it('disables the form while testing and re-enables it after failure', async () => {
    let resolveFetch: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = () => resolve(new Response(null, { status: 500 }));
          }),
      ),
    );

    render(<ServerSettingsPage />);
    fillUrl('https://memory.example.com');
    submit();

    await waitFor(() => expect(screen.getByRole('button', { name: /testing/i })).toBeDisabled());
    expect(screen.getByLabelText('Memory Server URL')).toBeDisabled();

    resolveFetch?.();

    await waitFor(() => expect(screen.getByRole('button', { name: /test & connect/i })).not.toBeDisabled());
  });
});
