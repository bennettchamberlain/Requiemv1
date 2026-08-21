import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { PowerRailProvider } from '../PowerRailContext';

import { MobileNavigation } from './MobileNavigation';
import { MobileTopBar } from './MobileTopBar';

vi.mock('@/common/feature', async () => {
  const actual = await vi.importActual<typeof import('@/common/feature')>('@/common/feature');

  return {
    ...actual,
    useFeatures: () => ({ isFeatureEnabled: () => true, loading: false, refresh: vi.fn() }),
  };
});

vi.mock('../SecondaryNavigation/useFeedBadgeCount', () => ({ useFeedBadgeCount: () => 0 }));

vi.mock('@/components/modals/CaptureModal', () => ({
  CaptureModal: () => <div data-testid="capture-modal" />,
}));
vi.mock('@/components/modals/UploadModal', () => ({ UploadModal: () => null }));
vi.mock('@/components/modals/AddItemModal', () => ({
  AddEventModal: () => null,
  AddPersonModal: () => null,
  AddPlaceModal: () => null,
}));
vi.mock('@/components/modals/AddItemModal/AddConceptModal.tsx', () => ({ AddConceptModal: () => null }));
vi.mock('@/components/modals/ThingModal', () => ({ ThingModal: () => null }));

vi.mock('@/api', async () => {
  const actual = await vi.importActual<typeof import('@/api')>('@/api');

  return {
    ...actual,
    useUploadFile: () => [null, { upload: vi.fn(), reset: vi.fn() }],
    useTriggerHbpe: () => [null, { trigger: vi.fn() }],
  };
});

vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');

  return {
    ...actual,
    useAuth: () => [{ isAuthenticated: true, authToken: 'token' }, { logout: vi.fn() }],
    useCurrentUser: () => ({ user: { name: 'Test User', email: 'test@example.com', onboarded: true } }),
    useCaptureModal: () => [{ isOpen: false }, { open: vi.fn(), close: vi.fn() }],
  };
});

vi.mock('@/components/ThemePicker', () => ({
  useTheme: () => ({ themeState: { mode: 'light' }, setTheme: vi.fn() }),
  ColorPicker: () => null,
}));

vi.mock('@/components/SearchBox', () => ({
  GlobalSearchBox: () => <input aria-label="Search memory" />,
}));

vi.mock('@/components/ConnectionModeIndicator', () => ({
  ConnectionModeIndicator: () => null,
  OutboxQueueIndicator: () => null,
}));

function renderMobileNav(route = '/today') {
  return renderWithProviders(
    <PowerRailProvider variant="overlay">
      <MobileTopBar />
      <MobileNavigation />
    </PowerRailProvider>,
    { route },
  );
}

describe('MobileNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts closed, with chevron, search, and Add in the top row', () => {
    renderMobileNav();

    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search memory' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(document.querySelector('img[src*="logo"]')).toBeNull();
  });

  it('opens the glass rail with the same destinations as the desktop list', async () => {
    renderMobileNav();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(await screen.findByRole('link', { name: 'Plan' })).toHaveAttribute('href', '/plan');
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/chat');
    expect(screen.getAllByRole('button', { name: 'Close menu' }).length).toBeGreaterThanOrEqual(1);
  });

  it('puts the account in the header, left of the close chevron, linking to profile', async () => {
    renderMobileNav();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    const nav = await screen.findByRole('navigation');
    const account = screen.getByRole('link', { name: 'Test User' });
    const close = nav.querySelector('[aria-label="Close menu"]');
    const plan = screen.getByRole('link', { name: 'Plan' });

    expect(account).toHaveAttribute('href', '/profile');
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument();
    expect(close).toBeTruthy();
    expect(account.compareDocumentPosition(close as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect((close as Node).compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens on a right swipe from the left edge', async () => {
    renderMobileNav();

    fireEvent.touchStart(document, { touches: [{ clientX: 8, clientY: 240 }] });
    fireEvent.touchEnd(document, { changedTouches: [{ clientX: 80, clientY: 240 }] });

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Today' })).toBeInTheDocument();
    });
  });
});
