import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { PowerRailProvider } from '../PowerRailContext';

import { MobileNavigation } from './MobileNavigation';

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

vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');

  return {
    ...actual,
    useAuth: () => [{ isAuthenticated: true, authToken: 'token' }, { logout: vi.fn() }],
    useCurrentUser: () => ({ user: { name: 'Test User', email: 'test@example.com', onboarded: true } }),
    useCaptureModal: () => [{ isOpen: false }, { open: vi.fn(), close: vi.fn() }],
  };
});

function renderMobileNav(route = '/today') {
  return renderWithProviders(
    <PowerRailProvider variant="overlay">
      <MobileNavigation />
    </PowerRailProvider>,
    { route },
  );
}

describe('MobileNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts closed, with the open-edge control and no tab bar', () => {
    renderMobileNav();

    expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(document.querySelector('img[src*="logo"]')).toBeNull();
  });

  it('opens the glass rail with the same destinations as the desktop list', async () => {
    renderMobileNav();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(await screen.findByRole('link', { name: 'Plan' })).toHaveAttribute('href', '/plan');
    expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/chat');
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search');
    expect(screen.getByRole('button', { name: 'Close menu' })).toBeInTheDocument();
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
