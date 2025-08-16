import { type RefObject, useMemo } from 'react';

import { Bot } from '@ci/shadcn/icons';

interface Props {
  content?: string;
  streamingRef?: RefObject<HTMLDivElement | null>;
}

export function AssistantMessage({ content, streamingRef }: Props) {
  const trimmedContent = useMemo(() => content?.trim(), [content]);

  if (!trimmedContent) {
    return null;
  }

  return (
    <div className="relative self-start max-w-[100%] rounded-xl rounded-tl-none px-4 py-3 text-sm whitespace-pre-wrap leading-relaxed shadow-sm bg-gradient-to-br from-muted to-muted/80 text-foreground border border-border/50 backdrop-blur-sm">
      {content && <div>{trimmedContent}</div>}

      <div ref={streamingRef} />

      <div className="absolute -top-2 -left-2 p-1 rounded-full bg-gradient-to-br from-gray-400 to-gray-400">
        <Bot className="h-4 w-4 text-primary-foreground z-10" />
      </div>
    </div>
  );
}
