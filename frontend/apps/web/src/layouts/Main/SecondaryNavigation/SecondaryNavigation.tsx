import { Tooltip } from '@ci/shadcn';
import { Brain, ChartPie, Inbox, Lightbulb, MessagesSquare } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

export function SecondaryNavigation() {
  return (
    <nav className="flex flex-col gap-2 p-2">
      <Tooltip.Provider>
        <Tooltip>
          <Tooltip.Trigger asChild>
            <Link
              to="/feed"
              aria-label="Feed"
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition"
            >
              <Inbox className="h-6 w-6" strokeWidth={1.25} />
            </Link>
          </Tooltip.Trigger>
          <Tooltip.Content side="right">Feed</Tooltip.Content>
        </Tooltip>

        <Tooltip>
          <Tooltip.Trigger asChild>
            <Link
              to="/memory"
              aria-label="Memory"
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition"
            >
              <Brain className="h-6 w-6" strokeWidth={1.25} />
            </Link>
          </Tooltip.Trigger>
          <Tooltip.Content side="right">Memory</Tooltip.Content>
        </Tooltip>

        <Tooltip>
          <Tooltip.Trigger asChild>
            <Link
              to="/insights"
              aria-label="Insights"
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition"
            >
              <Lightbulb className="h-6 w-6" strokeWidth={1.25} />
            </Link>
          </Tooltip.Trigger>
          <Tooltip.Content side="right">Insights</Tooltip.Content>
        </Tooltip>

        <Tooltip>
          <Tooltip.Trigger asChild>
            <Link
              to="/chat"
              aria-label="Chat"
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition"
            >
              <MessagesSquare className="h-6 w-6" strokeWidth={1.25} />
            </Link>
          </Tooltip.Trigger>
          <Tooltip.Content side="right">Chat</Tooltip.Content>
        </Tooltip>

        <Tooltip>
          <Tooltip.Trigger asChild>
            <Link
              to="/knowledge"
              aria-label="Knowledge"
              className="p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition"
            >
              <ChartPie className="h-6 w-6" strokeWidth={1.25} />
            </Link>
          </Tooltip.Trigger>
          <Tooltip.Content side="right">Knowledge</Tooltip.Content>
        </Tooltip>
      </Tooltip.Provider>
    </nav>
  );
}
