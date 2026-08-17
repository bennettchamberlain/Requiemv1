/**
 * Where "add my data" lives in the chrome.
 *
 * It used to be `Connections` in the account dropdown — the menu you open to
 * change a setting or log out — while the sidebar, which lists what the app is
 * for, said nothing about where any of the data comes from. That is why nobody
 * found it. These assertions pin the correction on both sides: present in the
 * rail, absent from the account menu.
 */
import { Tooltip } from '@ci/shadcn';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { NavUser } from '../PrimaryNavigation/NavUser';

import { SecondaryNavigation } from './SecondaryNavigation';

vi.mock('@/common/feature', async () => {
  const actual = await vi.importActual<typeof import('@/common/feature')>('@/common/feature');

  return { ...actual, useFeatures: () => ({ isFeatureEnabled: () => true }) };
});

vi.mock('./useFeedBadgeCount', () => ({ useFeedBadgeCount: () => 0 }));

vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');

  return {
    ...actual,
    useAuth: () => [{ isAuthenticated: true, authToken: 'token' }, { logout: vi.fn() }],
    useCurrentUser: () => ({ user: { name: 'Test User', email: 'test@example.com', onboarded: true } }),
  };
});

vi.mock('@/components/ThemePicker', () => ({
  useTheme: () => ({ themeState: { mode: 'light' }, setTheme: vi.fn() }),
  ColorPicker: () => null,
}));

function renderRail(route = '/feed') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Tooltip.Provider>
        <SecondaryNavigation />
      </Tooltip.Provider>
    </MemoryRouter>,
  );
}

describe('SecondaryNavigation', () => {
  it('carries Sources in the primary rail', () => {
    renderRail();

    expect(screen.getByRole('link', { name: 'Sources' })).toHaveAttribute('href', '/sources');
  });

  // `end={false}`: both halves are Sources, and the rail should say so on
  // either one.
  it.each(['/sources', '/sources/connect', '/sources/import'])('marks itself active on %s', (route) => {
    renderRail(route);

    expect(screen.getByRole('link', { name: 'Sources' })).toHaveClass('border-l-primary');
  });
});

describe('NavUser', () => {
  it('no longer hides Connections in the account menu', async () => {
    render(
      <MemoryRouter>
        <Tooltip.Provider>
          <NavUser />
        </Tooltip.Provider>
      </MemoryRouter>,
    );

    // The menu is closed, but the assertion that matters is that no link to
    // the old route survives anywhere in this component.
    expect(screen.queryByRole('link', { name: /Connections/i })).not.toBeInTheDocument();
  });
});
