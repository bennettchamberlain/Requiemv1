import { Tooltip } from '@ci/shadcn';
import {
  Brain,
  ChartPie,
  Inbox,
  Lightbulb,
  MessagesSquare,
  Package,
  HardDrive,
  NotebookPen,
  FolderSearch2,
} from '@ci/shadcn/icons';

import { NavLink } from './NavLink';

export function SecondaryNavigation() {
  return (
    <nav className="flex flex-col gap-2 p-2">
      <Tooltip.Provider>
        <NavLink to="/feed" label="Feed">
          <Inbox className="h-6 w-6" strokeWidth={1.25} />
        </NavLink>

        <NavLink to="/memory" label="Memory">
          <Brain className="h-6 w-6" strokeWidth={1.25} />
        </NavLink>

        <NavLink to="/insights" label="Insights">
          <Lightbulb className="h-6 w-6" strokeWidth={1.25} />
        </NavLink>

        <NavLink to="/chat" label="Chat">
          <MessagesSquare className="h-6 w-6" strokeWidth={1.25} />
        </NavLink>

        <NavLink to="/saved-searches" label="Saved Searches">
          <FolderSearch2 className="h-6 w-6" strokeWidth={1.25} />
        </NavLink>

        <NavLink to="/notes" label="Notes" end={false}>
          <NotebookPen className="h-6 w-6" strokeWidth={1.25} />
        </NavLink>

        <NavLink to="/knowledge" label="Knowledge">
          <ChartPie className="h-6 w-6" strokeWidth={1.25} />
        </NavLink>

        <NavLink to="/inventory" label="Inventory">
          <Package className="h-6 w-6" strokeWidth={1.25} />
        </NavLink>

        <NavLink to="/files" label="Files">
          <HardDrive className="h-6 w-6" strokeWidth={1.25} />
        </NavLink>
      </Tooltip.Provider>
    </nav>
  );
}
