import { Button, DropdownMenu } from '@ci/shadcn';
import { ExternalLink, MessagesSquare } from '@ci/shadcn/icons';
import { useNavigate } from 'react-router-dom';

import { useAgentHarnesses } from '@/api/useAgentHarnesses';
import {
  type AgentChatContext,
  openAgentHarness,
  openInAppChat,
} from '@/lib/agentChat';

interface Props {
  context: AgentChatContext;
  size?: 'sm' | 'icon';
  className?: string;
}

export function ChatWithAgentMenu({ context, size = 'icon', className }: Props) {
  const navigate = useNavigate();
  const { accessibleHarnesses, loading } = useAgentHarnesses();

  const singleHarness = accessibleHarnesses.length === 1 ? accessibleHarnesses[0] : null;

  if (size === 'sm' && singleHarness?.openUrl) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => openAgentHarness(singleHarness.openUrl!, context)}
      >
        <ExternalLink className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
        Open with agent
      </Button>
    );
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenu.Trigger asChild>
        {size === 'icon' ? (
          <Button variant="ghost" size="icon" className={className} aria-label={`Chat about ${context.title}`}>
            <MessagesSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className={className}>
            <MessagesSquare className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
            Chat
          </Button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item onClick={() => openInAppChat(navigate, context)}>Chat here</DropdownMenu.Item>
        {!loading &&
          accessibleHarnesses.map((harness) => (
            <DropdownMenu.Item
              key={harness.id}
              onClick={() => openAgentHarness(harness.openUrl!, context)}
            >
              Open with {harness.name}
            </DropdownMenu.Item>
          ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
