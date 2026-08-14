/**
 * Where the status chips live in the desktop chrome.
 *
 * They used to render in a `fixed top-2 right-2` overlay owned by the Main
 * layout, which is pinned to the viewport rather than to any layout box — and
 * the desktop layout's own header puts the add menu and the account avatar in
 * exactly that corner. The overlay sat on top of both, hiding them behind
 * whatever the chip's label happened to be (worst with the widest one, "Not
 * synced yet"). The chips belong in the header's flow, where the header's own
 * layout accounts for them.
 *
 * The mobile layout has no header, so it keeps the fixed placement — nothing
 * here applies to it.
 */

import { type ReactNode } from 'react';

import { setApiKey } from '@ci/common/src/utils/apiAuth';
import { setApiBaseUrl } from '@ci/common/src/utils/apiBase';
import { ConnectionModeProvider } from '@ci/common/src/utils/connectionMode';
import { OutboxQueueProvider } from '@ci/common/src/utils/outboxFlush';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { okResponse, urlOf } from './fetchFakes';
import { renderWithProviders } from './renderWithProviders';

/** The chip's own providers, nested as App.tsx nests them. */
function ChipProviders({ children }: { children: ReactNode }) {
  return (
    <ConnectionModeProvider args={[]}>
      <OutboxQueueProvider args={[]}>{children}</OutboxQueueProvider>
    </ConnectionModeProvider>
  );
}

// Auth / Model / Features context all fetch on mount, so `renderWithProviders`
// deliberately does not provide them — components that consume them stub them
// instead (the documented pattern). The header's own children pull in all
// three: NavUser (auth, current user, features) and the capture modal the add
// menu mounts (auth, model).
vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');

  return {
    ...actual,
    useAuth: () => [{ isAuthenticated: true, authToken: 'token' }, { logout: vi.fn() }],
    useCurrentUser: () => ({ user: { name: 'Test User', email: 'test@example.com', onboarded: true } }),
    useModel: () => [{ selectedVisionModel: null }, { setSelectedVisionModel: vi.fn() }],
  };
});

vi.mock('@/common/feature', async () => {
  const actual = await vi.importActual<typeof import('@/common/feature')>('@/common/feature');

  return { ...actual, useFeatures: () => ({ isFeatureEnabled: () => true }) };
});

// The header mounts every add-menu modal (closed) alongside the chrome, and
// each drags in its own context graph — chat requester, uploads, inventory.
// None of that bears on where the chips sit, so the modals are stubbed out
// rather than provided for.
vi.mock('@/components/modals/CaptureModal', () => ({ CaptureModal: () => null }));
vi.mock('@/components/modals/UploadModal', () => ({ UploadModal: () => null }));
vi.mock('@/components/modals/AddItemModal', () => ({ AddPersonModal: () => null }));
vi.mock('@/components/modals/AddItemModal/AddConceptModal.tsx', () => ({ AddConceptModal: () => null }));
vi.mock('@/components/modals/InventoryItemModal', () => ({ InventoryItemModal: () => null }));

beforeEach(() => {
  // An unreachable appliance is the case that produced the report: it resolves
  // to the widest label, "Not synced yet".
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo) => {
      if (urlOf(input).includes('/api/health')) {
        throw new Error('appliance unreachable');
      }

      return okResponse();
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setApiBaseUrl('');
  setApiKey(null);
});

describe('PrimaryNavigation — status chips', () => {
  it('renders the connection chip inside the header, not in a viewport-pinned overlay over it', async () => {
    // Imported lazily so the module-level mocks above are in place first.
    const { PrimaryNavigation } = await import('@/layouts/Main/PrimaryNavigation');

    const { container } = renderWithProviders(
      <ChipProviders>
        <PrimaryNavigation />
      </ChipProviders>,
      { withTheme: true },
    );

    const chip = await waitFor(() => screen.getByText('Not synced yet'));
    const header = container.querySelector('header');

    expect(header).not.toBeNull();
    expect(header).toContainElement(chip);

    // Nothing between the chip and the header may take it out of flow: a
    // `fixed`/`absolute` ancestor is what let it land on top of the controls.
    for (let node = chip.parentElement; node && node !== header; node = node.parentElement) {
      expect(node.className).not.toMatch(/(^|\s)(fixed|absolute)(\s|$)/);
    }
  });

  it('keeps the add menu and the account avatar clickable rather than covered by the chip', async () => {
    const { PrimaryNavigation } = await import('@/layouts/Main/PrimaryNavigation');

    renderWithProviders(
      <ChipProviders>
        <PrimaryNavigation />
      </ChipProviders>,
      { withTheme: true },
    );

    const chip = await waitFor(() => screen.getByText('Not synced yet'));

    // The two controls the overlay used to cover. The chip shares their flow
    // row, so the row lays all three out side by side instead of stacking the
    // chip on top of them.
    const addButton = screen.getByRole('button', { name: 'Add' });
    const accountButton = screen.getByRole('button', { name: 'Account' });
    const cluster = chip.closest('div')?.parentElement;

    expect(cluster).not.toBeNull();
    expect(cluster).toContainElement(addButton);
    expect(cluster).toContainElement(accountButton);
  });
});
