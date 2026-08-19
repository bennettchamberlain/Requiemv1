import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { Portal } from '@ci/common';
import { Sheet, cn } from '@ci/shadcn';
import { Camera, MonitorCog, MoreHorizontal, Search, type LucideIcon } from '@ci/shadcn/icons';
import { Link, useLocation } from 'react-router-dom';

import { CaptureModal } from '@/components/modals/CaptureModal';
import { useCaptureModal } from '@/hooks';

import {
  HELP_LINKS,
  isRailDestinationActive,
  mobilePrimaryTabCount,
  splitMobileDestinations,
  useVisibleRailDestinations,
  type RailDestination,
} from '../railDestinations';
import { useFeedBadgeCount } from '../SecondaryNavigation/useFeedBadgeCount';

/**
 * Mobile chrome is the Power Rail laid on its side.
 *
 * Destinations walk left to right in rail order. Whatever does not fit — plus
 * Search, Capture, Help, and System, which the rail never carried as tabs —
 * lives under the last action. Chat is MessagesSquare, same as the rail; the
 * companion mark is the product, not a destination.
 */
export function MobileNavigation() {
  const destinations = useVisibleRailDestinations();
  const feedBadgeCount = useFeedBadgeCount();
  const { pathname } = useLocation();
  const [{ isOpen: captureOpen }, { open: openCapture, close: closeCapture }] = useCaptureModal();
  const [moreOpen, setMoreOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const [primaryCount, setPrimaryCount] = useState(() => mobilePrimaryTabCount(0, destinations.length));

  useEffect(() => {
    const bar = barRef.current;

    if (!bar) {
      return;
    }

    const measure = () => {
      setPrimaryCount(mobilePrimaryTabCount(bar.clientWidth, destinations.length));
    };

    measure();

    const observer = new ResizeObserver(measure);

    observer.observe(bar);

    return () => observer.disconnect();
  }, [destinations.length]);

  const { primary, overflow } = splitMobileDestinations(destinations, primaryCount);
  const overflowActive = overflow.some((destination) => isRailDestinationActive(destination, pathname));
  const moreActive =
    overflowActive || pathname.startsWith('/search') || pathname.startsWith('/system') || moreOpen;

  const handleCapture = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      setMoreOpen(false);
      openCapture();
    },
    [openCapture],
  );

  return (
    <>
      {captureOpen && (
        <Portal.Slot id="content-modal">
          <CaptureModal open onClose={closeCapture} />
        </Portal.Slot>
      )}

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <nav className="border-t bg-secondary pb-[env(safe-area-inset-bottom)]">
          <div ref={barRef} className="flex flex-row items-stretch">
            {primary.map((destination) => (
              <TabLink
                key={destination.id}
                destination={destination}
                pathname={pathname}
                badgeCount={destination.badge === 'feed' ? feedBadgeCount : 0}
              />
            ))}
            <button
              type="button"
              aria-label="More"
              aria-expanded={moreOpen}
              aria-current={moreActive ? 'page' : undefined}
              onClick={() => setMoreOpen(true)}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 p-3 select-none',
                moreActive && 'text-primary',
              )}
            >
              <MoreHorizontal className="h-6 w-6" strokeWidth={1.25} />
              <span className="text-xxs">More</span>
            </button>
          </div>
        </nav>

        <Sheet.Content
          side="bottom"
          className="max-h-[80vh] gap-0 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <Sheet.Header>
            <Sheet.Title>More</Sheet.Title>
            <Sheet.Description className="sr-only">
              The rest of the rail, plus search, capture, help, and system.
            </Sheet.Description>
          </Sheet.Header>

          {overflow.length > 0 && (
            <MoreSection>
              {overflow.map((destination) => (
                <MoreLink
                  key={destination.id}
                  to={destination.to}
                  label={destination.label}
                  icon={destination.icon}
                  active={isRailDestinationActive(destination, pathname)}
                  badgeCount={destination.badge === 'feed' ? feedBadgeCount : 0}
                  onClick={() => setMoreOpen(false)}
                />
              ))}
            </MoreSection>
          )}

          <MoreSection>
            <MoreLink
              to="/search"
              label="Search"
              icon={Search}
              active={pathname.startsWith('/search')}
              onClick={() => setMoreOpen(false)}
            />
            <button
              type="button"
              onClick={handleCapture}
              className="flex w-full items-center gap-3 rounded-md px-4 py-3 text-left transition hover:bg-accent"
            >
              <Camera className="h-5 w-5 shrink-0" strokeWidth={1.25} />
              <span className="text-sm">Capture</span>
            </button>
            {HELP_LINKS.map((link) => {
              const Icon = link.icon;

              return (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full items-center gap-3 rounded-md px-4 py-3 text-left transition hover:bg-accent"
                >
                  <Icon className="h-5 w-5 shrink-0" strokeWidth={1.25} />
                  <span className="text-sm">{link.label}</span>
                </a>
              );
            })}
            <MoreLink
              to="/system"
              label="System"
              icon={MonitorCog}
              active={pathname.startsWith('/system')}
              onClick={() => setMoreOpen(false)}
            />
          </MoreSection>
        </Sheet.Content>
      </Sheet>
    </>
  );
}

function TabLink({
  destination,
  pathname,
  badgeCount,
}: {
  destination: RailDestination;
  pathname: string;
  badgeCount: number;
}) {
  const Icon = destination.icon;
  const active = isRailDestinationActive(destination, pathname);

  return (
    <Link
      to={destination.to}
      aria-label={destination.label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 p-3 select-none',
        active && 'text-primary',
      )}
    >
      <Icon className="h-6 w-6" strokeWidth={1.25} />
      <span className="max-w-full truncate text-xxs">{destination.label}</span>
      {badgeCount > 0 && (
        <span className="pointer-events-none absolute right-1 top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </Link>
  );
}

function MoreSection({ children }: { children: ReactNode }) {
  return <div className="flex flex-col px-2 pb-2">{children}</div>;
}

function MoreLink({
  to,
  label,
  icon: Icon,
  active,
  badgeCount = 0,
  onClick,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  badgeCount?: number;
  onClick: () => void;
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-md px-4 py-3 text-left transition hover:bg-accent',
        active && 'text-primary',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.25} />
      <span className="flex-1 text-sm">{label}</span>
      {badgeCount > 0 && (
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </Link>
  );
}
