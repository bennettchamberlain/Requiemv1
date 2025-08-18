import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { type ComponentProps, type ReactNode, type RefObject, useCallback, useMemo, useRef } from 'react';

import { useReadablePump } from '@ci/common';

import { ThinkBlock, ToolBlock } from '../ChatBlocks';

import { ChatInput } from './ChatInput';
import { ChatLoader } from './ChatLoader';
import { ChatThread } from './ChatThread';
import { AssistantMessage } from './blocks/AssistantMessage';
import { Channel, toFrameStream, type Decoded } from './utils';

type ChatInputProps = ComponentProps<typeof ChatInput>;

interface Message {
  role: string;
  content: string;
}
interface Props extends ChatInputProps {
  messages?: Message[];
  readable?: ReadableStream<Uint8Array>;
  emptyState?: ReactNode;
}

const textDecoder = new TextDecoder();
const supportedChannels = new Set([Channel.TEXT, Channel.THINK, Channel.TOOL]);

export function Chat({ messages, readable, loading, emptyState, ...chatInputProps }: Props) {
  // These refs are used to point to the parent elements of the blocks
  // that are receiving streaming text. We will need to clone the elements when a
  // block is finished. These are important for that strategy.
  const textBlockRef = useRef<HTMLDivElement | null>(null);
  const thinkBlockRef = useRef<HTMLDivElement | null>(null);

  // We need a target to insert our accumulated messages.
  // We are avoiding doing this in React state because we don't want to trigger
  // re-renders. This avoids some DOM flickering shenanigans.
  const blocksRef = useRef<HTMLDivElement | null>(null);

  // These refs are used to point to the stream target for text coming from
  // the LLM endpoint.
  const textStreamingRef = useRef<HTMLDivElement | null>(null);
  const thinkStreamingRef = useRef<HTMLDivElement | null>(null);

  // We want to track the channel of the last message we've received.
  // If we receive a message in a new channel we'll know to kick off
  // the clone / swap flow.
  const lastChannelRef = useRef<number | null>(null);

  const handleFrameChunk = useCallback((chunk: Decoded) => {
    if (!supportedChannels.has(chunk.channel)) {
      console.log('Ignored unsupported chunk channel:', chunk.channel);

      return true; // consumed → read next chunk
    }

    const lastChannel = lastChannelRef.current;
    const payload = textDecoder.decode(chunk.payload);

    lastChannelRef.current = chunk.channel;

    if (lastChannel != null && chunk.channel !== lastChannel) {
      if (lastChannel === Channel.TEXT) {
        const clone = textBlockRef.current?.cloneNode(true);

        textStreamingRef.current?.replaceChildren();

        if (clone && thinkBlockRef.current) {
          blocksRef.current?.insertBefore(clone, thinkBlockRef.current);
        }
      } else if (lastChannel === Channel.THINK) {
        const clone = thinkBlockRef.current?.cloneNode(true);

        thinkStreamingRef.current?.replaceChildren();

        if (clone && thinkBlockRef.current) {
          blocksRef.current?.insertBefore(clone, thinkBlockRef.current);
        }
      }
    }

    if (chunk.channel === Channel.TOOL) {
      let parsed: { function: { name: string } }[] = [];

      try {
        parsed = JSON.parse(payload) as { function: { name: string } }[];
      } catch (err) {
        console.error('Error parsing tool payload', err);
      }

      try {
        const toolBlocks = parsed.map((tool) => <ToolBlock toolName={tool.function.name} />);
        const container = document.createDocumentFragment();
        const root: Root = createRoot(container);

        flushSync(() => {
          root.render(toolBlocks);
        });

        blocksRef.current?.insertBefore(container, thinkBlockRef.current);
      } catch (err) {
        console.error('Error inserting tool block', err);
      }

      return true;
    }

    if (chunk.channel === Channel.TEXT || chunk.channel === Channel.THINK) {
      let targetRef: RefObject<HTMLDivElement | null> = textStreamingRef;

      if (chunk.channel === Channel.TEXT) {
        targetRef = textStreamingRef;
      } else if (chunk.channel === Channel.THINK) {
        targetRef = thinkStreamingRef;
      }

      const el = targetRef.current;

      if (el == null) {
        return false; // not ready → buffer it
      }

      const textNode = document.createTextNode(payload);

      el.appendChild(textNode);
    }

    return true; // consumed → read next chunk
  }, []);

  const frameStream = useMemo(() => toFrameStream(readable ?? null), [readable]);
  const { drain } = useReadablePump(frameStream, handleFrameChunk);

  const setTextStreamingRef = useCallback(
    (el: HTMLDivElement | null) => {
      textStreamingRef.current = el;

      if (el) {
        drain();
      }
    },
    [drain],
  );

  const setThinkStreamingRef = useCallback(
    (el: HTMLDivElement | null) => {
      thinkStreamingRef.current = el;

      if (el) {
        drain();
      }
    },
    [drain],
  );

  return (
    <div className="flex flex-col h-full min-h-0 w-full">
      {emptyState && (
        <div className="flex flex-col flex-1 min-h-0 p4 items-center justify-center">{emptyState}</div>
      )}

      {!emptyState && (
        <div
          ref={blocksRef}
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
              <ThinkBlock
                renderEmptyContent={true}
                defaultExpanded={true}
                ref={thinkBlockRef}
                streamingRef={setThinkStreamingRef}
              />

              <AssistantMessage
                renderEmptyContent={true}
                ref={textBlockRef}
                streamingRef={setTextStreamingRef}
              />
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
