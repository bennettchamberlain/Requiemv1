import { type ReactNode } from 'react';

import { Collapsible, Tooltip, cn } from '@ci/shadcn';
import { Camera, ChevronRight, CircleHelp, MonitorCog } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import { CaptureModal } from '@/components/modals/CaptureModal';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useCaptureModal, useCurrentUser } from '@/hooks';

import { usePowerRail } from '../PowerRailContext';
import { NavUser } from '../PrimaryNavigation/NavUser';
import { HELP_LINKS, useVisibleRailDestinations } from '../railDestinations';
import { RailEdgeToggle } from '../RailEdgeToggle';

import { MemorySubmenu } from './MemorySubmenu';
import { NavLink } from './NavLink';
import { SelfSubmenu } from './SelfSubmenu';
import { useFeedBadgeCount } from './useFeedBadgeCount';

interface ExternalNavLinkProps {
  href: string;
  label: string;
  children: ReactNode;
}

function ExternalNavLink({ href, label, children }: ExternalNavLinkProps) {
  const { expanded } = usePowerRail();

  const link = (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="relative flex items-center gap-3 rounded-md px-2 py-2 transition will-change-transform hover:bg-accent hover:text-accent-foreground active:scale-95"
    >
      {children}
      {expanded && <span className="truncate text-sm">{label}</span>}
    </a>
  );

  if (expanded) {
    return link;
  }

  return (
    <Tooltip>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Tooltip.Content side="right">{label}</Tooltip.Content>
    </Tooltip>
  );
}

/**
 * Support and Docs, under one entry.
 *
 * Two separate rows for "where do I get help" is one more than the question
 * has. Collapsed, it is a single icon whose tooltip says Help; the two
 * destinations are one click in either state, rather than two permanent rows
 * competing with the places you actually work.
 */
function HelpSubmenu() {
  const { expanded } = usePowerRail();

  if (!expanded) {
    return (
      <Tooltip>
        <Tooltip.Trigger asChild>
          <a
            href={HELP_LINKS[0].href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Help"
            className="relative flex items-center justify-center rounded-md p-2 transition hover:bg-accent hover:text-accent-foreground active:scale-95"
          >
            <CircleHelp className="h-6 w-6 shrink-0" strokeWidth={1.25} />
          </a>
        </Tooltip.Trigger>
        <Tooltip.Content side="right">Help</Tooltip.Content>
      </Tooltip>
    );
  }

  return (
    <Collapsible>
      <Collapsible.Trigger className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-accent hover:text-accent-foreground [&[data-state=open]>svg:last-child]:rotate-90">
        {/* Same 32px leading cell as the account avatar so "Help" and the
            name share one left edge, instead of each label padding off its
            own icon width. */}
        <span className="grid size-8 shrink-0 place-items-center">
          <CircleHelp className="h-6 w-6" strokeWidth={1.25} />
        </span>
        <span className="flex-1 truncate text-sm">Help</span>
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200" />
      </Collapsible.Trigger>
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="flex flex-col gap-1 pl-6 pt-1">
          {HELP_LINKS.map((link) => {
            const Icon = link.icon;

            return (
              <ExternalNavLink key={link.href} href={link.href} label={link.label}>
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.25} />
              </ExternalNavLink>
            );
          })}
        </div>
      </Collapsible.Content>
    </Collapsible>
  );
}

/**
 * Phone drawer chrome: the account opens the profile page. Help and the
 * account menus live there, not as rail dropdowns. Desktop keeps those at
 * the foot of the rail.
 */
function OverlayRailHeader({ closeOverlay }: { closeOverlay: () => void }) {
  const { user } = useCurrentUser();

  const name = user?.name || user?.email || 'User';

  return (
    <div className="flex items-center gap-1 pt-2 pb-1.5">
      <Link
        to="/profile"
        aria-label={name}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left transition hover:bg-accent hover:text-accent-foreground"
      >
        {/* size="sm" is 32px — the exact h-8 w-8 this rendered before
            PersonAvatar existed. */}
        <PersonAvatar name={name} avatarUrl={user?.avatarUrl} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
      </Link>
      <RailEdgeToggle open onClick={closeOverlay} className="shrink-0" />
    </div>
  );
}

function OverlayRail({
  destinationsList,
  closeOverlay,
  expanded,
}: {
  destinationsList: ReactNode;
  closeOverlay: () => void;
  expanded: boolean;
}) {
  const [{ isOpen: captureOpen }, { open: openCapture, close: closeCapture }] = useCaptureModal();

  return (
    <>
      {captureOpen && <CaptureModal open onClose={closeCapture} />}
      <nav
        id="power-rail"
        data-state={expanded ? 'expanded' : 'collapsed'}
        aria-hidden={!expanded}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('a')) {
            closeOverlay();
          }
        }}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-56 flex-col overflow-x-hidden px-2 pb-[max(0.5rem,var(--safe-area-bottom))] pt-[var(--safe-area-top)] transition-transform duration-200',
          'border-r border-white/55 bg-white/35 shadow-xl backdrop-blur-xl dark:border-white/20 dark:bg-white/10',
          expanded ? 'translate-x-0' : 'pointer-events-none -translate-x-full',
        )}
      >
        <Tooltip.Provider>
          <OverlayRailHeader closeOverlay={closeOverlay} />
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto [scrollbar-gutter:stable]">
            {destinationsList}
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => {
                  closeOverlay();
                  openCapture();
                }}
                className="flex items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-accent hover:text-accent-foreground"
              >
                <Camera className="h-6 w-6 shrink-0" strokeWidth={1.25} />
                <span className="truncate text-sm">Capture</span>
              </button>
              <NavLink to="/system" label="System">
                <MonitorCog className="h-6 w-6 shrink-0" strokeWidth={1.25} />
              </NavLink>
            </div>
          </div>
        </Tooltip.Provider>
      </nav>
    </>
  );
}

export function SecondaryNavigation() {
  const { expanded, pinned, setHovered, variant, closeOverlay } = usePowerRail();
  const destinations = useVisibleRailDestinations();
  const feedBadgeCount = useFeedBadgeCount();
  const overlay = variant === 'overlay';

  const destinationsList = (
    <div className="flex flex-col gap-1">
      {destinations.map((destination) => {
        if (destination.id === 'memory') {
          return <MemorySubmenu key={destination.id} />;
        }

        if (destination.id === 'self') {
          return <SelfSubmenu key={destination.id} />;
        }

        const Icon = destination.icon;

        return (
          <NavLink
            key={destination.id}
            to={destination.to}
            label={destination.label}
            end={destination.end}
            badgeCount={destination.badge === 'feed' ? feedBadgeCount : 0}
          >
            <Icon className="h-6 w-6 shrink-0" strokeWidth={1.25} />
          </NavLink>
        );
      })}
    </div>
  );

  if (overlay) {
    return (
      <OverlayRail destinationsList={destinationsList} closeOverlay={closeOverlay} expanded={expanded} />
    );
  }

  return (
    // A drawer, not a column that shoves the page around.
    //
    // The wrapper always occupies the collapsed width, so the layout beside it
    // never moves on hover. The rail itself is absolutely positioned inside
    // that lane and grows over the content when it opens — brushing past on
    // the way to something else costs you a widening panel, not a reflow of
    // everything you were reading.
    //
    // Pinning is the exception, and deliberately so: a pinned rail takes real
    // width, the content settles beside it once, and it stays that way.
    <div
      className={cn('relative h-full shrink-0 transition-[width] duration-200', pinned ? 'w-56' : 'w-14')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setHovered(false);
        }
      }}
    >
      <nav
        id="power-rail"
        data-state={expanded ? 'expanded' : 'collapsed'}
        className={cn(
          'absolute inset-y-0 left-0 z-30 flex flex-col overflow-x-hidden p-2 transition-[width] duration-200',
          'bg-secondary/20 backdrop-blur-sm',
          expanded ? 'w-56' : 'w-14',
          // Only when it is floating over the content does it need to look
          // like it: pinned, it is part of the furniture.
          expanded && !pinned && 'border-r border-r-secondary/90 shadow-xl',
        )}
      >
        <Tooltip.Provider>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto [scrollbar-gutter:stable]">
            {destinationsList}
          </div>

          <div className="mt-auto flex flex-col gap-1 pb-2">
            <HelpSubmenu />

            <NavUser />
          </div>
        </Tooltip.Provider>
      </nav>
    </div>
  );
}
