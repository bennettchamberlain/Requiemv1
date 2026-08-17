import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TodayPage } from './TodayPage';

const features = vi.hoisted(() => ({ scheduleEnabled: true }));

vi.mock('@ci/common', () => ({
  usePageTitle: () => undefined,
  Portal: { Slot: ({ children }: { children: React.ReactNode }) => <div>{children}</div> },
}));
vi.mock('@ci/shadcn', () => {
  const Breadcrumb = Object.assign(({ children }: { children: React.ReactNode }) => <nav>{children}</nav>, {
    List: ({ children }: { children: React.ReactNode }) => <ol>{children}</ol>,
    Item: ({ children }: { children: React.ReactNode }) => <li>{children}</li>,
    Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    Separator: () => <span />,
    Page: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  });

  return { Breadcrumb };
});
vi.mock('@/common/feature', () => ({
  useFeatures: () => ({
    isFeatureEnabled: (flag: string) => (flag === 'schedule.page' ? features.scheduleEnabled : true),
  }),
}));
vi.mock('@/components/layout', () => ({
  PageContent: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/pages/SchedulePage', () => ({
  SchedulePage: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="schedule">schedule embedded={String(embedded)}</div>
  ),
}));
vi.mock('@/pages/FeedPage', () => ({
  default: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="feed">feed embedded={String(embedded)}</div>
  ),
}));

/**
 * Today is the schedule plus the brief on one page. Three things have to hold:
 * the order (the part with a time on it leads; the commentary follows), that
 * both are asked for in their embedded variant — a child rendering its own
 * breadcrumb, title and PageContent is what put two of each on one screen, and
 * PageContent is the scroll container, so nesting it nests scrollbars — and
 * that `schedule.page` still hides the schedule, which it used to do by
 * removing a route that no longer exists.
 */
describe('TodayPage', () => {
  beforeEach(() => {
    features.scheduleEnabled = true;
  });

  it('puts the schedule above the feed', () => {
    render(<TodayPage />);

    const schedule = screen.getByTestId('schedule');
    const feed = screen.getByTestId('feed');

    expect(schedule).toBeInTheDocument();
    expect(feed).toBeInTheDocument();
    // DOCUMENT_POSITION_FOLLOWING: the feed comes after the schedule.
    expect(schedule.compareDocumentPosition(feed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('embeds both, so neither draws the chrome this page owns', () => {
    render(<TodayPage />);

    expect(screen.getByTestId('schedule')).toHaveTextContent('embedded=true');
    expect(screen.getByTestId('feed')).toHaveTextContent('embedded=true');
  });

  it('names itself Today in the breadcrumb', () => {
    render(<TodayPage />);

    expect(screen.getByText('Today')).toBeInTheDocument();
  });

  it('drops the schedule, and its rule, when schedule.page is off', () => {
    features.scheduleEnabled = false;

    const { container } = render(<TodayPage />);

    expect(screen.queryByTestId('schedule')).not.toBeInTheDocument();
    // A rule above the only thing on the page separates it from nothing.
    expect(container.querySelector('hr')).toBeNull();
    expect(screen.getByTestId('feed')).toBeInTheDocument();
  });
});
