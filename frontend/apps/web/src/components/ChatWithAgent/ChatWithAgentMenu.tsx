import { Button, DropdownMenu } from '@ci/shadcn';
import { ExternalLink, MessagesSquare } from '@ci/shadcn/icons';
import { useNavigate } from 'react-router-dom';

import { useAgentHarnesses } from '@/api/useAgentHarnesses';
import { type AgentChatContext, openAgentHarness, openChatHere } from '@/lib/agentChat';

interface Props {
  context: AgentChatContext;
  size?: 'sm' | 'icon';
  className?: string;
}

export function ChatWithAgentMenu({ context, size = 'icon', className }: Props) {
  const navigate = useNavigate();
  const { openableHarnesses, loading } = useAgentHarnesses();

  const defaultHarness = openableHarnesses.length === 1 ? openableHarnesses[0] : null;

  if (size === 'sm' && defaultHarness?.openUrl) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => openAgentHarness(defaultHarness.openUrl!, context)}
      >
        <ExternalLink className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
        Chat here
      </Button>
    );
  }

  if (size === 'sm' && !loading && openableHarnesses.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        className={className}
        onClick={() => openChatHere(navigate, context, openableHarnesses)}
      >
        <MessagesSquare className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
        Chat here
      </Button>
    );
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenu.Trigger asChild>
        {size === 'icon' ? (
          <Button
            variant="ghost"
            size="icon"
            className={className}
            aria-label={`Chat about ${context.title}`}
          >
            <MessagesSquare className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Button>
        ) : (
          <Button variant="outline" size="sm" className={className}>
            <MessagesSquare className="mr-1.5 h-3.5 w-3.5" strokeWidth={1.5} />
            Chat here
          </Button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item onClick={() => openChatHere(navigate, context, openableHarnesses)}>
          Chat here
        </DropdownMenu.Item>
        {!loading &&
          openableHarnesses.map((harness) => (
            <DropdownMenu.Item key={harness.id} onClick={() => openAgentHarness(harness.openUrl!, context)}>
              Open with {harness.name}
            </DropdownMenu.Item>
          ))}
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
