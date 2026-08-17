import type { ReactNode } from 'react';

import { Tooltip } from '@ci/shadcn';
import {
  BookOpen,
  Brain,
  Cable,
  CalendarRange,
  ChartColumn,
  LifeBuoy,
  ListTodo,
  MessagesSquare,
  NotebookPen,
  FolderSearch2,
} from '@ci/shadcn/icons';

import { useFeatures } from '@/common/feature';

import { NavLink } from './NavLink';
import { useFeedBadgeCount } from './useFeedBadgeCount';

interface ExternalNavLinkProps {
  href: string;
  label: string;
  children: ReactNode;
}

function ExternalNavLink({ href, label, children }: ExternalNavLinkProps) {
  return (
    <Tooltip>
      <Tooltip.Trigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="relative rounded-md p-2 transition will-change-transform hover:bg-accent hover:text-accent-foreground active:scale-95"
        >
          {children}
        </a>
      </Tooltip.Trigger>
      <Tooltip.Content side="right">{label}</Tooltip.Content>
    </Tooltip>
  );
}

export function SecondaryNavigation() {
  const { isFeatureEnabled } = useFeatures();
  const feedBadgeCount = useFeedBadgeCount();

  return (
    <nav className="flex h-full flex-col p-2">
      <Tooltip.Provider>
        <div className="flex flex-col gap-2">
          {/* One entry, because Schedule and Feed are one page now. The
              calendar icon rather than the inbox tray: the page opens on the
              day's schedule, and a tray promised a queue of things to clear
              that this page never was. The feed's badge count rides along,
              since its cards are still the part that wants attention. */}
          <NavLink to="/today" label="Today" badgeCount={feedBadgeCount}>
            <CalendarRange className="h-6 w-6" strokeWidth={1.25} />
          </NavLink>

          <NavLink to="/memory" label="Memory">
            <Brain className="h-6 w-6" strokeWidth={1.25} />
          </NavLink>

          {isFeatureEnabled('chat.page') && (
            <NavLink to="/chat" label="Chat">
              <MessagesSquare className="h-6 w-6" strokeWidth={1.25} />
            </NavLink>
          )}

          <NavLink to="/saved-searches" label="Saved Searches">
            <FolderSearch2 className="h-6 w-6" strokeWidth={1.25} />
          </NavLink>

          {isFeatureEnabled('planning.page') && (
            <NavLink to="/plan" label="Plan">
              <ListTodo className="h-6 w-6" strokeWidth={1.25} />
            </NavLink>
          )}

          {isFeatureEnabled('stats.page') && (
            <NavLink to="/stats" label="Stats">
              <ChartColumn className="h-6 w-6" strokeWidth={1.25} />
            </NavLink>
          )}

          <NavLink to="/notes" label="Notes" end={false}>
            <NotebookPen className="h-6 w-6" strokeWidth={1.25} />
          </NavLink>

          {/* Getting data in belongs in the rail that lists what the app is
              FOR, not in the account dropdown next to Settings and Log out —
              that is a menu you open to change a setting, not to add data.
              `end={false}` so both halves of Sources light it up. Not
              flag-gated: the route is not either, and the connect half exists
              whatever `import.page` says. */}
          <NavLink to="/sources" label="Sources" end={false}>
            <Cable className="h-6 w-6" strokeWidth={1.25} />
          </NavLink>
        </div>

        <div className="mt-auto flex flex-col gap-2 pb-2">
          <ExternalNavLink href="https://ci.computer/support" label="Support">
            <LifeBuoy className="h-6 w-6" strokeWidth={1.25} />
          </ExternalNavLink>

          <ExternalNavLink
            href="https://docs.ci.computer/docs/first-party-apps/digital-memory-server"
            label="Docs"
          >
            <BookOpen className="h-6 w-6" strokeWidth={1.25} />
          </ExternalNavLink>
        </div>
      </Tooltip.Provider>
    </nav>
  );
}
