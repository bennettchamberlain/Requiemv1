import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiKeysSection } from './ApiKeysSection';

// ApiKeysSection reads useAuth from the @/hooks barrel and talks to /api/keys through fetchJson.
const h = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useAuth: () => [{ authToken: 'token' }, {}],
}));

vi.mock('@ci/common', () => ({
  fetchJson: h.fetchJson,
}));

/** The parsed body of the key-creation POST, or undefined if it was never sent. */
function createBody(): Record<string, unknown> | undefined {
  const call = h.fetchJson.mock.calls.find(
    ([url, init]) => url === '/api/keys' && (init as { method?: string } | undefined)?.method === 'POST',
  );

  return call ? JSON.parse((call[1] as { body: string }).body) : undefined;
}

async function openCreateDialogAndName() {
  fireEvent.click(await screen.findByRole('button', { name: /create api key/i }));
  fireEvent.change(await screen.findByLabelText(/^name$/i), { target: { value: 'laptop' } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
}

describe('ApiKeysSection scope picker', () => {
  beforeEach(() => {
    h.fetchJson.mockReset();
    // Route by method rather than a blanket resolve: the component refetches the list right after
    // creating, and handing that GET the create response makes it render-crash on keys.map.
    h.fetchJson.mockImplementation((_url: string, init?: { method?: string }) =>
      Promise.resolve(init?.method === 'POST' ? { id: '1', key: 'raw-key' } : []),
    );
  });

  it('omits scopes when nothing is selected, preserving the full-access default', async () => {
    render(<ApiKeysSection />);
    await openCreateDialogAndName();

    submit();

    await waitFor(() => expect(createBody()).toBeDefined());
    // Absent rather than an empty array — an omitted field keeps the grandfathered meaning.
    expect(createBody()).not.toHaveProperty('scopes');
  });

  it('sends only the selected scopes', async () => {
    render(<ApiKeysSection />);
    await openCreateDialogAndName();

    fireEvent.click(screen.getByLabelText('MCP'));
    submit();

    await waitFor(() => expect(createBody()).toBeDefined());
    expect(createBody()?.scopes).toEqual(['mcp']);
  });

  it('accumulates scopes and drops one when unchecked', async () => {
    render(<ApiKeysSection />);
    await openCreateDialogAndName();

    fireEvent.click(screen.getByLabelText('Memory'));
    fireEvent.click(screen.getByLabelText('MCP'));
    fireEvent.click(screen.getByLabelText('Memory'));
    submit();

    await waitFor(() => expect(createBody()).toBeDefined());
    expect(createBody()?.scopes).toEqual(['mcp']);
  });

  it('clears the selection when the dialog is cancelled', async () => {
    render(<ApiKeysSection />);
    await openCreateDialogAndName();
    fireEvent.click(screen.getByLabelText('MCP'));

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    // Reopening must not carry the previous selection: a stale scope would mint a
    // limited key while the user believed it had full access.
    await openCreateDialogAndName();
    submit();

    await waitFor(() => expect(createBody()).toBeDefined());
    expect(createBody()).not.toHaveProperty('scopes');
  });
});
