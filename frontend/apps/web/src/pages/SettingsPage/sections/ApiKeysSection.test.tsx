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

  it('announces what each scope unlocks, not just its name', async () => {
    render(<ApiKeysSection />);
    await openCreateDialogAndName();

    // The description has to reach assistive tech as the checkbox's description. Naming the box
    // with aria-label instead would drop it, leaving "MCP" with no statement of what it grants.
    const mcp = screen.getByRole('checkbox', { name: 'MCP' });

    expect(mcp).toHaveAccessibleDescription(
      'Reach the Model Context Protocol endpoint (/api/mcp) — pair with Intents to see any tools',
    );
  });

  // A key with `mcp` and no `intents` authenticates, opens a session, and advertises zero tools.
  // Agents surface that as "this server has no tools", so the dialog has to say it up front —
  // otherwise the picker's most obvious selection is also its most broken one.
  it('warns that MCP without Intents advertises no tools', async () => {
    render(<ApiKeysSection />);
    await openCreateDialogAndName();

    expect(screen.queryByText(/advertises no tools/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('MCP'));

    expect(screen.getByText(/MCP alone advertises no tools/i)).toBeInTheDocument();
  });

  it('announces the warning rather than showing it only in amber', async () => {
    render(<ApiKeysSection />);
    await openCreateDialogAndName();

    fireEvent.click(screen.getByLabelText('MCP'));

    // The warning appears after render, so it reaches a screen reader only from a live region.
    // Without one it is visible-only and the broken combination gets picked in silence.
    expect(screen.getByText(/MCP alone advertises no tools/i).closest('[role="status"]')).toBeInTheDocument();
  });

  it('drops the warning once Intents is added, and when MCP is removed', async () => {
    render(<ApiKeysSection />);
    await openCreateDialogAndName();

    fireEvent.click(screen.getByLabelText('MCP'));
    fireEvent.click(screen.getByLabelText('Intents'));

    expect(screen.queryByText(/advertises no tools/i)).not.toBeInTheDocument();

    // Removing Intents brings it back — the pair is what matters, not the order they were picked.
    fireEvent.click(screen.getByLabelText('Intents'));
    expect(screen.getByText(/MCP alone advertises no tools/i)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('MCP'));
    expect(screen.queryByText(/advertises no tools/i)).not.toBeInTheDocument();
  });

  // Memory alone must not trigger it — the warning is specific to the MCP tool surface.
  it('does not warn for a scope selection that has nothing to do with MCP', async () => {
    render(<ApiKeysSection />);
    await openCreateDialogAndName();

    fireEvent.click(screen.getByLabelText('Memory'));

    expect(screen.queryByText(/advertises no tools/i)).not.toBeInTheDocument();
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
