import { Button, DropdownMenu } from '@ci/shadcn';
import { MessagesSquare } from '@ci/shadcn/icons';
import { useNavigate } from 'react-router-dom';

import { type AgentChatContext, openAgentApp, openInAppChat } from '@/lib/agentChat';

interface Props {
  context: AgentChatContext;
  size?: 'sm' | 'icon';
  className?: string;
}

export function ChatWithAgentMenu({ context, size = 'icon', className }: Props) {
  const navigate = useNavigate();

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
        <DropdownMenu.Item onClick={() => openAgentApp('hermes', context)}>Chat with Hermes</DropdownMenu.Item>
        <DropdownMenu.Item onClick={() => openAgentApp('openclaw', context)}>Chat with OpenClaw</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
