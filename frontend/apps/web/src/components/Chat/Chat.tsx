import { type ComponentProps, type ReactNode, useCallback, useRef } from 'react';

import { useReadablePump } from '@ci/common';

import { ChatInput } from './ChatInput';
import { ChatLoader } from './ChatLoader';
import { ChatThread } from './ChatThread';
import { AssistantMessage } from './blocks/AssistantMessage';
import { useMultiplexTaggedStream } from './hooks/useMultiplexTaggedStream';

type ChatInputProps = ComponentProps<typeof ChatInput>;

interface Message {
  role: string;
  content: string;
}
interface Props extends ChatInputProps {
  messages?: Message[];
  readable?: ReadableStream<string>;
  emptyState?: ReactNode;
}

export function Chat({ messages, readable, loading, emptyState, ...chatInputProps }: Props) {
  const textContainerRef = useRef<HTMLDivElement | null>(null);
  const thinkContainerRef = useRef<HTMLDivElement | null>(null);
  const toolContainerRef = useRef<HTMLDivElement | null>(null);

  const mux = useMultiplexTaggedStream(readable, (ended) => {
    if (ended === 'tool') {
      console.log('Tool block finished');
    } else if (ended === 'think') {
      // console.log('Think block finished');
    } else {
      // console.log('Text block finished');
    }
  });

  const { drain: drainText } = useReadablePump(mux?.text ?? null, (chunk) => {
    // console.log('Text chunk', chunk);

    const el = textContainerRef.current;

    if (el == null) {
      return false; // not ready → buffer it
    }

    const textNode = document.createTextNode(chunk);

    el.appendChild(textNode);

    return true; // consumed → read next chunk
  });

  const { drain: drainThink } = useReadablePump(mux?.think ?? null, (chunk) => {
    const el = thinkContainerRef.current;

    if (el == null) {
      return false; // not ready → buffer it
    }

    const textNode = document.createTextNode(chunk);

    el.appendChild(textNode);

    return true; // consumed → read next chunk
  });

  const { drain: drainTool } = useReadablePump(mux?.tool ?? null, (chunk) => {
    const el = toolContainerRef.current;

    if (el == null) {
      return false; // not ready → buffer it
    }

    const textNode = document.createTextNode(chunk);

    el.appendChild(textNode);

    return true; // consumed → read next chunk
  });

  // When the div mounts, immediately replay any queued chunks
  const setTextRef = useCallback(
    (el: HTMLDivElement | null) => {
      textContainerRef.current = el;

      if (el) {
        drainText();
      }
    },
    [drainText],
  );

  const setThinkRef = useCallback(
    (el: HTMLDivElement | null) => {
      thinkContainerRef.current = el;

      if (el) {
        drainThink();
      }
    },
    [drainThink],
  );

  const setToolRef = useCallback(
    (el: HTMLDivElement | null) => {
      toolContainerRef.current = el;

      if (el) {
        drainTool();
      }
    },
    [drainTool],
  );

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      {emptyState && (
        <div className="flex flex-col flex-1 min-h-0 p4 items-center justify-center">{emptyState}</div>
      )}

      {!emptyState && (
        <div
          className="
          flex flex-col gap-4 flex-1 min-h-0 overflow-y-scroll p-4
          [mask-image:linear-gradient(to_top,transparent,hsl(0_0%_100%)_2rem)]
          [mask-repeat:no-repeat] [mask-size:100%_100%]
          [-webkit-mask-image:linear-gradient(to_top,transparent,hsl(0_0%_100%)_2rem)]
          [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:100%_100%]
        "
        >
          <ChatThread messages={messages} />

          {readable && (
            <>
              <AssistantMessage renderEmptyContent={true} streamingRef={setToolRef} />
              <AssistantMessage renderEmptyContent={true} streamingRef={setThinkRef} />
              <AssistantMessage renderEmptyContent={true} streamingRef={setTextRef} />
            </>
          )}
        </div>
      )}

      <div className="p-4 pt-4 pl-1 w-full relative">
        {loading && <ChatLoader />}

        <ChatInput loading={loading} {...chatInputProps} />
      </div>
    </div>
  );
}
