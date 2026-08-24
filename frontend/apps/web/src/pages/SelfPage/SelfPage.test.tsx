import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { SelfPage } from './SelfPage';

// Each tab body already has its own test coverage (AccountSection.test.tsx,
// StatsPage.test.tsx, AboutYouSection/PersonForm inside SelfProfileTab, and
// PromptsPage's own reflections tests). What's unique to this file is the tab
// bar + route composition, so the bodies are stubbed to keep this focused and
// free of their own dependencies (Apollo mocks, auth mocks, stats service
// mocks).
vi.mock('./SelfProfileTab', () => ({
  SelfProfileTab: () => <div>profile-tab-body</div>,
}));
vi.mock('@/pages/SettingsPage/sections/AccountSection', () => ({
  AccountSection: () => <div>account-tab-body</div>,
}));
vi.mock('@/pages/StatsPage/StatsPage', () => ({
  StatsPage: () => <div>stats-tab-body</div>,
}));
vi.mock('@/pages/PromptsPage/PromptsPage', () => ({
  PromptsPage: () => <div>reflections-tab-body</div>,
}));
vi.mock('@/common/feature', () => ({
  useFeatures: () => ({ isFeatureEnabled: () => true }),
}));

function renderAt(route: string) {
  return renderWithProviders(<SelfPage />, { route, path: '/self/*' });
}

describe('SelfPage', () => {
  it('shows the Profile tab at /self, active', () => {
    renderAt('/self');

    expect(screen.getByText('profile-tab-body')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Profile' })).toHaveClass('bg-primary');
    expect(screen.getByRole('link', { name: 'Account' })).not.toHaveClass('bg-primary');
  });

  it('shows the Account tab at /self/account, active', () => {
    renderAt('/self/account');

    expect(screen.getByText('account-tab-body')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Account' })).toHaveClass('bg-primary');
    expect(screen.getByRole('link', { name: 'Profile' })).not.toHaveClass('bg-primary');
  });

  it('shows the Stats tab at /self/stats, active', () => {
    renderAt('/self/stats');

    expect(screen.getByText('stats-tab-body')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Stats' })).toHaveClass('bg-primary');
  });

  it('shows the Reflections tab at /self/reflections, active', () => {
    renderAt('/self/reflections');

    expect(screen.getByText('reflections-tab-body')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reflections' })).toHaveClass('bg-primary');
  });

  it('redirects an unknown sub-path back to Profile', () => {
    renderAt('/self/nonsense');

    expect(screen.getByText('profile-tab-body')).toBeInTheDocument();
  });
});
