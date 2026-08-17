import type { ReactNode } from 'react';

import { Tooltip, cn } from '@ci/shadcn';
import {
  BookOpen,
  Brain,
  Cable,
  CalendarRange,
  ChartColumn,
  CloudSun,
  LifeBuoy,
  Inbox,
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

function RailGroupLabel({ children }: { children: ReactNode }) {
  const { expanded } = usePowerRail();

  if (!expanded) {
    return null;
  }

  return (
    <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-1">
      {children}
    </div>
  );
}

export function SecondaryNavigation() {
  const { expanded } = usePowerRail();
  const { isFeatureEnabled } = useFeatures();
  const feedBadgeCount = useFeedBadgeCount();

  return (
    <nav
      id="power-rail"
      data-state={expanded ? 'expanded' : 'collapsed'}
      className={cn(
        'flex h-full flex-col overflow-x-hidden p-2 transition-[width] duration-200',
        expanded ? 'w-56' : 'w-14',
      )}
    >
      <Tooltip.Provider>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          <RailGroupLabel>Main</RailGroupLabel>
          <div className="flex flex-col gap-1">
            {isFeatureEnabled('planning.page') && (
              <NavLink to="/plan" label="Plan">
                <ListTodo className="h-6 w-6 shrink-0" strokeWidth={1.25} />
              </NavLink>
            )}

            {isFeatureEnabled('schedule.page') && (
              <NavLink to="/schedule" label="Schedule">
                <CalendarRange className="h-6 w-6 shrink-0" strokeWidth={1.25} />
              </NavLink>
            )}

            <NavLink to="/forecast" label="Forecast">
              <CloudSun className="h-6 w-6 shrink-0" strokeWidth={1.25} />
            </NavLink>

            <NavLink to="/brief" label="Brief" badgeCount={feedBadgeCount}>
              <Inbox className="h-6 w-6 shrink-0" strokeWidth={1.25} />
            </NavLink>

            <NavLink to="/memory" label="Memory">
              <Brain className="h-6 w-6 shrink-0" strokeWidth={1.25} />
            </NavLink>
          </div>

          <RailGroupLabel>More</RailGroupLabel>
          <div className="flex flex-col gap-1">
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
          <ExternalNavLink href="https://ci.computer/support" label="Support">
            <LifeBuoy className="h-6 w-6 shrink-0" strokeWidth={1.25} />
          </ExternalNavLink>

          <ExternalNavLink
            href="https://docs.ci.computer/docs/first-party-apps/digital-memory-server"
            label="Docs"
          >
            <BookOpen className="h-6 w-6 shrink-0" strokeWidth={1.25} />
          </ExternalNavLink>

          <NavUser />
        </div>
      </Tooltip.Provider>
    </nav>
  );
}
