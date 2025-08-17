import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react';

import { AssistantMessage } from './blocks/AssistantMessage';
import { ChatInput } from './ChatInput';
import { ChatLoader } from './ChatLoader';
import { ChatThread } from './ChatThread';

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
  const streamContainerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController>(null);

  useEffect(() => {
    if (!readable) {
      return;
    }

    const ac = new AbortController();
    const reader = readable.getReader();

    abortRef.current = ac;

    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();

          if (done) {
            break;
          }

          if (!streamContainerRef.current) {
            return;
          }

          const textNode = document.createTextNode(value);

          streamContainerRef.current.appendChild(textNode);
        }
      } catch (err) {
        if (ac.signal.aborted) {
          return;
        }

        console.error('Error reading stream', err);
      } finally {
        try {
          reader.releaseLock();
        } catch (err) {
          console.error('Releasing stream lock failed', err);
        }
      }
    })();

    return () => {
      ac.abort();

      try {
        reader.cancel();
      } catch (err) {
        console.log('Readable stream cancelation failed', err);
      }
    };
  }, [readable]);

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      {emptyState && <div className="flex flex-col flex-1 min-h-0 p4 items-center justify-center">{emptyState}</div>}

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

          {readable && <AssistantMessage streamingRef={streamContainerRef} />}
        </div>
      )}

      <div className="p-4 pt-4 pl-1 w-full relative">
        {loading && <ChatLoader />}

        <ChatInput loading={loading} {...chatInputProps} />
      </div>
    </div>
  );
}
