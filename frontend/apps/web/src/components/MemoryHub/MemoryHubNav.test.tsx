import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { MemoryHubNav } from './MemoryHubNav';

vi.mock('@/common/feature', () => ({
  useFeatures: () => ({ isFeatureEnabled: () => true, loading: false, refresh: vi.fn() }),
}));

const originalMatchMedia = window.matchMedia;

function stubViewport(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobile && query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('MemoryHubNav', () => {
  it('lists Memory sections on desktop', async () => {
    stubViewport(false);

    renderWithProviders(<MemoryHubNav />, { route: '/memory/things' });

    expect(await screen.findByRole('navigation', { name: 'Memory sections' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Things' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'People' })).toBeInTheDocument();
  });

  it('hides the section menu on mobile and keeps page actions', async () => {
    stubViewport(true);

    renderWithProviders(<MemoryHubNav actions={<button type="button">New thing</button>} />, {
      route: '/memory/things',
    });

    await waitFor(() => {
      expect(screen.queryByRole('navigation', { name: 'Memory sections' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('link', { name: 'Things' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New thing' })).toBeInTheDocument();
  });
});
