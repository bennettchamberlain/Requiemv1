import { cn } from '@ci/shadcn';
import { Link, useLocation } from 'react-router-dom';

import { isRailDestinationActive, type RailDestination, useVisibleRailDestinations } from '../railDestinations';
import { useFeedBadgeCount } from '../SecondaryNavigation/useFeedBadgeCount';
import { usePlanBadgeCount } from '../SecondaryNavigation/usePlanBadgeCount';

/**
 * The primary five, always one tap away — everything else (Sources, Jobs,
 * Forecast when it's on, the Saved Searches group's own Asks child) stays
 * reachable only through the drawer, the long tail this deliberately does
 * not try to cover.
 */
const PHONE_TAB_IDS = ['plan', 'calendar', 'memory', 'saved-searches', 'self'] as const;

function Tab({ destination, badgeCount }: { destination: RailDestination; badgeCount: number }) {
  const { pathname } = useLocation();
  // Reuses each destination's own active-match rule (Memory's isMemoryHubPath,
  // Sources' end: false, etc.) instead of a second, looser definition of
  // "current" that could disagree with the drawer for the same destination.
  const isActive = isRailDestinationActive(destination, pathname);
  const Icon = destination.icon;

  return (
    <Link
      to={destination.to}
      aria-label={destination.label}
      aria-current={isActive ? 'page' : undefined}
      className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-1 text-muted-foreground transition active:scale-95"
    >
      <span className="relative">
        <Icon className={cn('h-6 w-6', isActive && 'text-primary')} strokeWidth={isActive ? 2 : 1.5} />
        {badgeCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
            {badgeCount > 99 ? '99+' : badgeCount}
          </span>
        )}
      </span>
      <span className={cn('text-[10px] leading-none', isActive && 'font-medium text-primary')}>
        {destination.label}
      </span>
    </Link>
  );
}

/**
 * Bottom tab bar, phone only — D10: the drawer alone left zero destinations
 * one tap away. Sits in the layout flow (unlike the drawer, which floats
 * fixed over the content), so `<main>` shrinks to make room for it rather
 * than content ending up hidden behind it.
 */
export function PhoneTabBar() {
  const destinations = useVisibleRailDestinations();
  const feedBadgeCount = useFeedBadgeCount();
  const planBadgeCount = usePlanBadgeCount();

  const tabs = PHONE_TAB_IDS.map((id) => destinations.find((destination) => destination.id === id)).filter(
    (destination): destination is RailDestination => destination != null,
  );

  return (
    <nav
      aria-label="Primary"
      className="z-20 flex shrink-0 items-stretch border-t border-border bg-background pb-[max(0.25rem,var(--safe-area-bottom))]"
    >
      {tabs.map((destination) => (
        <Tab
          key={destination.id}
          destination={destination}
          badgeCount={
            destination.badge === 'feed'
              ? feedBadgeCount
              : destination.badge === 'plan'
                ? planBadgeCount
                : 0
          }
        />
      ))}
    </nav>
  );
}
