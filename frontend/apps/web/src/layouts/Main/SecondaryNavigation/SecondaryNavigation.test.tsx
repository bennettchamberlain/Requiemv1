/**
 * Where destinations live in the chrome.
 *
 * The left rail is the whole menu now: major pages, minor tools, and the
 * account cluster itself. These assertions pin that — present in the rail,
 * not in the account menu — and that expanding the rail reveals labels.
 */
import { Tooltip } from '@ci/shadcn';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PowerRailProvider } from '../PowerRailContext';
import { PowerRailToggle } from '../PowerRailToggle';
import { NavUser } from '../PrimaryNavigation/NavUser';

import { SecondaryNavigation } from './SecondaryNavigation';

const STORAGE_KEY = 'ci-power-rail-expanded';

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

beforeEach(() => {
  localStorage.removeItem(STORAGE_KEY);
});

function renderRail(route = '/plan', { expanded = false }: { expanded?: boolean } = {}) {
  if (expanded) {
    localStorage.setItem(STORAGE_KEY, 'true');
  }

  return render(
    <MemoryRouter initialEntries={[route]}>
      <PowerRailProvider>
        <Tooltip.Provider>
          <SecondaryNavigation />
        </Tooltip.Provider>
      </PowerRailProvider>
    </MemoryRouter>,
  );
}

function renderToggleAndRail(route = '/plan') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <PowerRailProvider>
        <Tooltip.Provider>
          <PowerRailToggle />
          <SecondaryNavigation />
        </Tooltip.Provider>
      </PowerRailProvider>
    </MemoryRouter>,
  );
}

describe('SecondaryNavigation', () => {
  it('carries Sources in the primary rail', () => {
    renderRail();

    expect(screen.getByRole('link', { name: 'Sources' })).toHaveAttribute('href', '/sources');
  });

  it('carries Jobs in the rail', () => {
    renderRail();

    expect(screen.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/jobs');
  });

  it('does not carry Notes in the rail', () => {
    renderRail();

    expect(screen.queryByRole('link', { name: 'Notes' })).not.toBeInTheDocument();
  });

  it('carries Plan in the primary rail', () => {
    renderRail();

    expect(screen.getByRole('link', { name: 'Plan' })).toHaveAttribute('href', '/plan');
  });

  it('carries Forecast and Today in the primary rail', () => {
    renderRail();

    expect(screen.getByRole('link', { name: 'Forecast' })).toHaveAttribute('href', '/forecast');
    expect(screen.getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/today');
  });

  // Schedule and Brief were folded into Today, so the rail must not offer a
  // second way to reach either — that was the point of combining them.
  it('no longer offers Schedule or Brief as their own destinations', () => {
    renderRail();

    expect(screen.queryByRole('link', { name: 'Schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Brief' })).not.toBeInTheDocument();
  });

  // One row that opens, not five flat ones. A wall of settings sitting level
  // with the places you actually work is the thing this replaced.
  it('keeps the account to one entry that opens', () => {
    renderRail('/feed', { expanded: true });

    const account = screen.getByRole('button', { name: /Test User/ });

    expect(account).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();

    fireEvent.click(account);

    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
  });

  // Appearance is a setting, not a peer of the places you work.
  it('nests theme and colours inside the account, not in the drawer', () => {
    renderRail('/feed', { expanded: true });

    fireEvent.click(screen.getByRole('button', { name: /Test User/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Theme' }));

    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Colours' })).toBeInTheDocument();
  });

  // Collapsed, the account is the avatar and one destination — a 56px rail is
  // no place for a nested accordion.
  it('collapses the account to a single link', () => {
    renderRail();

    expect(screen.getByRole('link', { name: /Test User/ })).toHaveAttribute('href', '/settings/appearance');
  });

  // Support and Docs were two permanent rows for one question.
  it('puts Support and Docs under one Help entry', () => {
    renderRail('/feed', { expanded: true });

    const help = screen.getByRole('button', { name: 'Help' });

    expect(screen.queryByRole('link', { name: 'Support' })).not.toBeInTheDocument();

    fireEvent.click(help);

    expect(screen.getByRole('link', { name: 'Support' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Docs' })).toBeInTheDocument();
  });

  // The drawer floats over the content on hover, so the lane it sits in keeps
  // the collapsed width and the page beside it never reflows.
  it('does not reflow the page when hover opens it', () => {
    const { container } = renderRail();

    const lane = container.querySelector('div.relative');
    const nav = screen.getByRole('navigation');

    expect(lane).toHaveClass('w-14');
    expect(nav).toHaveClass('absolute');
  });

  // The toggle shares the rail's `auto` grid column, so a wordmark appearing
  // there on hover widens the column and shoves the page — the exact reflow
  // the absolute drawer above exists to avoid.
  it('keeps the wordmark collapsed until the rail is pinned', () => {
    renderToggleAndRail();

    expect(screen.getByText('Companion Memory')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

    expect(screen.getByText('Companion Memory')).toHaveAttribute('aria-hidden', 'false');
  });

  // `end={false}`: both halves are Sources, and the rail should say so on
  // either one.
  it.each(['/sources', '/sources/connect', '/sources/import'])('marks itself active on %s', (route) => {
    renderRail(route);

    expect(screen.getByRole('link', { name: 'Sources' })).toHaveClass('border-l-primary');
  });

  it('stays icon-only until the rail is opened', () => {
    renderRail();

    expect(screen.getByRole('navigation')).toHaveAttribute('data-state', 'collapsed');
    expect(screen.queryByText('Memory')).not.toBeInTheDocument();
  });

  it('shows labels when expanded, without a Sources submenu', () => {
    renderRail('/plan', { expanded: true });

    expect(screen.getByRole('navigation')).toHaveAttribute('data-state', 'expanded');
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Import' })).not.toBeInTheDocument();
  });

  it('lists the spine then More in time-and-tool order', () => {
    renderRail();

    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));

    expect(hrefs.indexOf('/plan')).toBeLessThan(hrefs.indexOf('/today'));
    expect(hrefs.indexOf('/today')).toBeLessThan(hrefs.indexOf('/forecast'));
    expect(hrefs.indexOf('/forecast')).toBeLessThan(hrefs.indexOf('/memory'));
    expect(hrefs.indexOf('/memory')).toBeLessThan(hrefs.indexOf('/saved-searches'));
    expect(hrefs.indexOf('/saved-searches')).toBeLessThan(hrefs.indexOf('/chat'));
    expect(hrefs.indexOf('/chat')).toBeLessThan(hrefs.indexOf('/sources'));
    expect(hrefs.indexOf('/sources')).toBeLessThan(hrefs.indexOf('/jobs'));
    expect(hrefs.indexOf('/jobs')).toBeLessThan(hrefs.indexOf('/stats'));
  });
});

describe('PowerRailToggle', () => {
  it('opens and closes the rail instead of navigating home', () => {
    renderToggleAndRail();

    const toggle = screen.getByRole('button', { name: 'Open menu' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'power-rail');
    expect(screen.queryByRole('link', { name: /Companion Intelligence/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Memory')).not.toBeInTheDocument();

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('Companion Memory')).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Close menu' }));

    expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Companion Memory')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByText('Main')).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });
});

describe('NavUser', () => {
  it('no longer hides Connections in the account menu', async () => {
    render(
      <MemoryRouter>
        <PowerRailProvider>
          <Tooltip.Provider>
            <NavUser />
          </Tooltip.Provider>
        </PowerRailProvider>
      </MemoryRouter>,
    );

    // The menu is closed, but the assertion that matters is that no link to
    // the old route survives anywhere in this component.
    expect(screen.queryByRole('link', { name: /Connections/i })).not.toBeInTheDocument();
  });

  it('no longer hides Jobs in the account menu', () => {
    render(
      <MemoryRouter>
        <PowerRailProvider>
          <Tooltip.Provider>
            <NavUser />
          </Tooltip.Provider>
        </PowerRailProvider>
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: 'Jobs' })).not.toBeInTheDocument();
  });
});
