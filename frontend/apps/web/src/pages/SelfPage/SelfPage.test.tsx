import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { SelfPage } from './SelfPage';

// Each tab body already has its own test coverage (AccountSection.test.tsx —
// now rendered inside SelfProfileTab, StatsPage.test.tsx, AboutYouSection/
// PersonForm inside SelfProfileTab, and PromptsPage's own reflections tests).
// What's unique to this file is the route composition (navigation itself
// lives in the Power Rail's SelfSubmenu, covered by SecondaryNavigation.test.tsx),
// so the bodies are stubbed to keep this focused and free of their own
// dependencies (Apollo mocks, auth mocks, stats service mocks).
vi.mock('./SelfProfileTab', () => ({
  SelfProfileTab: () => <div>profile-tab-body</div>,
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
  it('shows the Profile body at /self', () => {
    renderAt('/self');

    expect(screen.getByText('profile-tab-body')).toBeInTheDocument();
  });

  it('shows the Stats body at /self/stats', () => {
    renderAt('/self/stats');

    expect(screen.getByText('stats-tab-body')).toBeInTheDocument();
  });

  it('shows the Reflections body at /self/reflections', () => {
    renderAt('/self/reflections');

    expect(screen.getByText('reflections-tab-body')).toBeInTheDocument();
  });

  // Account was its own destination before it was folded into the bottom of
  // Profile — old bookmarks should still land somewhere real, not a blank page.
  it('redirects the retired /self/account back to Profile', () => {
    renderAt('/self/account');

    expect(screen.getByText('profile-tab-body')).toBeInTheDocument();
  });

  it('redirects an unknown sub-path back to Profile', () => {
    renderAt('/self/nonsense');

    expect(screen.getByText('profile-tab-body')).toBeInTheDocument();
  });
});
