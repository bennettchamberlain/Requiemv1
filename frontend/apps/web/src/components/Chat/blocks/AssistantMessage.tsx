import { type RefObject, useMemo } from 'react';

import { cn } from '@ci/shadcn';

import { Markdown } from '@/components/Markdown';

interface Props {
  content?: string;
  renderEmptyContent?: boolean;
  streamingRef?: RefObject<HTMLDivElement | null> | ((el: HTMLDivElement | null) => void);
}

function AssistantMessage({ content, renderEmptyContent = false, streamingRef }: Props) {
  const trimmedContent = useMemo(() => content?.trim(), [content]);

  if (!trimmedContent && !renderEmptyContent) {
    return null;
  }

  return (
    <div
      className={cn(
        'relative rounded-xl rounded-tl-none px-4 py-3 shadow-sm bg-gradient-to-br from-muted to-muted/80 text-foreground border border-border/50 backdrop-blur-sm',
        'has-[>.streaming-content:empty]:hidden',
      )}
    >
      <div className="streaming-content prose dark:prose-invert max-w-none" ref={streamingRef}>
        {trimmedContent && <Markdown>{trimmedContent}</Markdown>}
      </div>
    </div>
  );
}

export { AssistantMessage };
