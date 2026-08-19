import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

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

describe('MobileNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lays the rail left to right and parks the rest under More', async () => {
    renderWithProviders(<MobileNavigation />, { route: '/today' });

    expect(screen.getByRole('link', { name: 'Plan' })).toHaveAttribute('href', '/plan');
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/today');
    expect(screen.getByRole('link', { name: 'Forecast' })).toHaveAttribute('href', '/forecast');
    expect(screen.getByRole('link', { name: 'Memory' })).toHaveAttribute('href', '/memory/events');

    expect(screen.queryByRole('link', { name: 'Chat' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    expect(await screen.findByRole('link', { name: 'Chat' })).toHaveAttribute('href', '/chat');
    expect(screen.getByRole('link', { name: 'Sources' })).toHaveAttribute('href', '/sources');
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search');
    expect(screen.getByRole('link', { name: 'System' })).toHaveAttribute('href', '/system');
    expect(screen.getByRole('button', { name: 'Capture' })).toBeInTheDocument();
  });

  it('marks Today current and does not treat Chat as the product mark', () => {
    renderWithProviders(<MobileNavigation />, { route: '/today' });

    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Plan' })).not.toHaveAttribute('aria-current');
    expect(document.querySelector('img')).toBeNull();
  });

  it('lights More when the current page lives in the overflow', async () => {
    renderWithProviders(<MobileNavigation />, { route: '/chat' });

    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'More' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Chat' })).toHaveAttribute('aria-current', 'page');
    });
  });
});
