import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { PhoneTabBar } from './PhoneTabBar';

vi.mock('@/common/feature', async () => {
  const actual = await vi.importActual<typeof import('@/common/feature')>('@/common/feature');

  return { ...actual, useFeatures: () => ({ isFeatureEnabled: () => true }) };
});

vi.mock('../SecondaryNavigation/useFeedBadgeCount', () => ({ useFeedBadgeCount: () => 0 }));
vi.mock('../SecondaryNavigation/usePlanBadgeCount', () => ({ usePlanBadgeCount: () => 0 }));

function renderTabBar(route = '/plan') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <PhoneTabBar />
    </MemoryRouter>,
  );
}

/**
 * D10: the drawer alone left zero destinations one tap away on a phone. This
 * pins the five picked for the bar — Plan, Calendar, Memory, Saved Searches,
 * Self — and that everything else (Sources, Jobs, Asks) stays out of it, the
 * "long tail" the drawer still covers.
 */
describe('PhoneTabBar', () => {
  it('lists exactly Plan, Calendar, Memory, Saved Searches, and Self', () => {
    renderTabBar();

    expect(screen.getByRole('link', { name: 'Plan' })).toHaveAttribute('href', '/plan');
    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('href', '/calendar');
    expect(screen.getByRole('link', { name: 'Memory' })).toHaveAttribute('href', '/memory');
    expect(screen.getByRole('link', { name: 'Saved Searches' })).toHaveAttribute('href', '/saved-searches');
    expect(screen.getByRole('link', { name: 'Self' })).toHaveAttribute('href', '/self');
    expect(screen.getAllByRole('link')).toHaveLength(5);
  });

  it('does not list the long-tail destinations the drawer still covers', () => {
    renderTabBar();

    expect(screen.queryByRole('link', { name: 'Sources' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Jobs' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Asks' })).not.toBeInTheDocument();
  });

  it('marks the current tab, reusing each destination’s own active-match rule', () => {
    renderTabBar('/calendar');

    expect(screen.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Plan' })).not.toHaveAttribute('aria-current');
  });

  // Memory's own matcher (isMemoryHubPath) covers legacy detail routes
  // outside /memory/* — the tab has to agree with the drawer about that.
  it('lights Memory for a legacy people detail route', () => {
    renderTabBar('/people/abc123');

    expect(screen.getByRole('link', { name: 'Memory' })).toHaveAttribute('aria-current', 'page');
  });
});
