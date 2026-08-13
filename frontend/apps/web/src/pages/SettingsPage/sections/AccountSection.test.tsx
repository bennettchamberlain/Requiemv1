import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountSection } from './AccountSection';

/**
 * Account deletion is irreversible and is the in-app path both stores require, so the
 * things worth pinning are: it cannot fire until the user has retyped their own
 * address, and it authenticates the way NATIVE does (API key, no JWT) as well as the
 * way web does — a `Bearer null` here would break the App Store build, i.e. the only
 * client the requirement is actually about.
 */
const h = vi.hoisted(() => ({
  authToken: null as string | null,
  logout: vi.fn(),
  email: 'jsmith@example.com',
}));

vi.mock('@/hooks', () => ({
  useAuth: () => [{ authToken: h.authToken }, { logout: h.logout }],
  useCurrentUser: () => ({ user: { id: 'u1', email: h.email }, loading: false, error: undefined }),
}));

// `fetchJson` is the shared request layer; on native it attaches `x-api-key` itself.
// Spread the real module rather than replacing it: anything else rendered here that
// reaches for an `@ci/common` export should still get the real one.
const fetchJson = vi.hoisted(() => vi.fn());
vi.mock('@ci/common', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ci/common')>()),
  fetchJson,
}));

function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete account' }));
}

/** The confirm button inside the dialog (the card has a same-named opener). */
function confirmButton() {
  return screen.getAllByRole('button', { name: 'Delete account' }).at(-1)!;
}

beforeEach(() => {
  h.authToken = 'jwt-abc';
  h.email = 'jsmith@example.com';
  fetchJson.mockResolvedValue(undefined); // 204 No Content
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AccountSection', () => {
  it('shows the signed-in address and offers deletion', () => {
    render(<AccountSection />);

    expect(screen.getByText(/Signed in as jsmith@example.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeEnabled();
  });

  it('states what is deleted and when, in both the card and the dialog', () => {
    // This copy is a promise, and the store disclosures repeat it. It stayed
    // deliberately vague while nothing consumed `purge_after`; now that
    // AccountPurgeService does, it names the window and the files. Pinned here
    // so it cannot drift away from what the server actually does — the grace
    // period is `accountDeletion.graceDays`.
    render(<AccountSection />);

    expect(screen.getByText(/permanently deleted from this server after 30 days/i)).toBeInTheDocument();
    expect(screen.getByText(/files you uploaded/i)).toBeInTheDocument();

    openDialog();

    expect(screen.getByText(/After 30 days this account, its memories/i)).toBeInTheDocument();
  });

  it('keeps deletion disabled until the account address is retyped', async () => {
    render(<AccountSection />);
    openDialog();

    expect(confirmButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: 'someone@else.com' } });
    expect(confirmButton()).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: 'jsmith@example.com' } });
    await waitFor(() => expect(confirmButton()).toBeEnabled());
  });

  it('deletes the account and signs out when the confirmation matches', async () => {
    render(<AccountSection />);
    openDialog();

    fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: 'jsmith@example.com' } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(1));

    const [url, init] = fetchJson.mock.calls[0];
    expect(url).toBe('/api/account');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ confirmEmail: 'jsmith@example.com' });
    // Web session: the JWT rides as a Bearer token.
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-abc' });

    // Nothing left to stay signed in to.
    await waitFor(() => expect(h.logout).toHaveBeenCalled());
  });

  it('accepts a differently-cased confirmation', async () => {
    render(<AccountSection />);
    openDialog();

    fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: '  JSmith@Example.COM  ' } });
    await waitFor(() => expect(confirmButton()).toBeEnabled());
  });

  it('native (no JWT): sends NO Authorization header, leaving fetchJson to attach the API key', async () => {
    h.authToken = null;
    render(<AccountSection />);
    openDialog();

    fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: 'jsmith@example.com' } });
    fireEvent.click(confirmButton());

    await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(1));

    const [, init] = fetchJson.mock.calls[0];
    expect(init.headers).not.toHaveProperty('Authorization');
  });

  it('surfaces an error and stays signed in when the request fails', async () => {
    fetchJson.mockRejectedValue(new Error('Fetch failed: 500'));
    render(<AccountSection />);
    openDialog();

    fireEvent.change(screen.getByLabelText(/to confirm/i), { target: { value: 'jsmith@example.com' } });
    fireEvent.click(confirmButton());

    expect(await screen.findByText(/Could not delete the account/i)).toBeInTheDocument();
    expect(h.logout).not.toHaveBeenCalled();
  });
});
