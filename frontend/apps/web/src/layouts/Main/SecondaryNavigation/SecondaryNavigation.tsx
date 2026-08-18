import type { ReactNode } from 'react';

import { Collapsible, Tooltip, cn } from '@ci/shadcn';
import {
  BookOpen,
  Brain,
  ChevronRight,
  Cable,
  CalendarRange,
  ChartColumn,
  CloudSun,
  CircleHelp,
  LifeBuoy,
  ListTodo,
  MessagesSquare,
  FolderSearch2,
  Workflow,
} from '@ci/shadcn/icons';

import { useFeatures } from '@/common/feature';

import { usePowerRail } from '../PowerRailContext';
import { NavUser } from '../PrimaryNavigation/NavUser';

import { NavLink } from './NavLink';
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
            href="https://ci.computer/support"
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
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform" />
      </Collapsible.Trigger>
      <Collapsible.Content className="flex flex-col gap-1 pl-6">
        <ExternalNavLink href="https://ci.computer/support" label="Support">
          <LifeBuoy className="h-4 w-4 shrink-0" strokeWidth={1.25} />
        </ExternalNavLink>
        <ExternalNavLink
          href="https://docs.ci.computer/docs/first-party-apps/digital-memory-server"
          label="Docs"
        >
          <BookOpen className="h-4 w-4 shrink-0" strokeWidth={1.25} />
        </ExternalNavLink>
      </Collapsible.Content>
    </Collapsible>
  );
}

export function SecondaryNavigation() {
  const { expanded, pinned, setHovered } = usePowerRail();
  const { isFeatureEnabled } = useFeatures();
  const feedBadgeCount = useFeedBadgeCount();

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
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            <div className="flex flex-col gap-1">
              {isFeatureEnabled('planning.page') && (
                <NavLink to="/plan" label="Plan">
                  <ListTodo className="h-6 w-6 shrink-0" strokeWidth={1.25} />
                </NavLink>
              )}

              {/* One destination for the day: the schedule leads and the brief
                  follows, because "what is happening" and "what it means" were
                  two halves of one question answered from two places. Ungated,
                  because the brief half is always there — `schedule.page` gates
                  only the schedule within the page. The calendar icon over the
                  inbox tray: a tray promises a queue to clear, which this never
                  was. Forecast keeps its own entry — it describes a horizon
                  rather than a day. */}
              <NavLink to="/today" label="Today" badgeCount={feedBadgeCount}>
                <CalendarRange className="h-6 w-6 shrink-0" strokeWidth={1.25} />
              </NavLink>

              <NavLink to="/forecast" label="Forecast">
                <CloudSun className="h-6 w-6 shrink-0" strokeWidth={1.25} />
              </NavLink>

              <NavLink to="/memory" label="Memory">
                <Brain className="h-6 w-6 shrink-0" strokeWidth={1.25} />
              </NavLink>

              <NavLink to="/saved-searches" label="Saved Searches">
                <FolderSearch2 className="h-6 w-6 shrink-0" strokeWidth={1.25} />
              </NavLink>

              {isFeatureEnabled('chat.page') && (
                <NavLink to="/chat" label="Chat">
                  <MessagesSquare className="h-6 w-6 shrink-0" strokeWidth={1.25} />
                </NavLink>
              )}

              {/* One entry. Connect, import, and devices are paths on the same
                page — a rail submenu that opened a second accordion was a
                second way to do what the tiles already do. */}
              <NavLink to="/sources" label="Sources" end={false}>
                <Cable className="h-6 w-6 shrink-0" strokeWidth={1.25} />
              </NavLink>

              {isFeatureEnabled('jobs.page') && (
                <NavLink to="/jobs" label="Jobs">
                  <Workflow className="h-6 w-6 shrink-0" strokeWidth={1.25} />
                </NavLink>
              )}

              {isFeatureEnabled('stats.page') && (
                <NavLink to="/stats" label="Stats">
                  <ChartColumn className="h-6 w-6 shrink-0" strokeWidth={1.25} />
                </NavLink>
              )}
            </div>
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
