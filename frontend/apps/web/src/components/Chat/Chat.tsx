import {
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { v7 as uuid7 } from 'uuid';

import { ThinkBlock, ToolBlock } from '../ChatBlocks';

import { AssistantMessage } from './blocks/AssistantMessage';
import { UserMessage } from './blocks/UserMessage';
import { ChatInput, type FormData } from './ChatInput';
import { ChatLoader } from './ChatLoader';
import { ChatMessage } from './ChatMessage';
import { Channel, FrameDecoder, type Decoded } from './utils';

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

export function Chat({
  messages,
  readable,
  loading,
  streaming,
  emptyState,
  onSubmit,
  ...chatInputProps
}: Props) {
  const [accumulatedMessages, setAccumulatedMessages] = useState<ReactNode[]>([]);

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

  const flushStream = useCallback((channel: Channel) => {
    let block: ReactNode | undefined;

    if (channel === Channel.TEXT) {
      const text = textStreamingRef.current?.textContent;
      block = <AssistantMessage key={uuid7()} content={text ?? ''} />;

      thinkStreamingRef.current?.replaceChildren();
    } else if (channel === Channel.THINK) {
      const text = thinkStreamingRef.current?.textContent;
      block = <ThinkBlock key={uuid7()} content={text ?? ''} defaultExpanded={true} />;

      thinkStreamingRef.current?.replaceChildren();
    }

    setAccumulatedMessages((prev) => [...prev, block]);
  }, []);

  const handleFrameChunk = useCallback(
    (chunk: Decoded) => {
      if (!supportedChannels.has(chunk.channel)) {
        console.log('Ignored unsupported chunk channel:', chunk.channel);

        return true; // consumed → read next chunk
      }

      const lastChannel = lastChannelRef.current;
      const payload = textDecoder.decode(chunk.payload);

      lastChannelRef.current = chunk.channel;

      if (lastChannel != null && chunk.channel !== lastChannel) {
        flushStream(lastChannel);
      }

      if (chunk.channel === Channel.TOOL) {
        let parsed: { function: { name: string } }[] = [];

        try {
          parsed = JSON.parse(payload) as { function: { name: string } }[];
        } catch (err) {
          console.error('Error parsing tool payload', err);
        }

        try {
          const toolBlocks = parsed.map((tool) => <ToolBlock key={uuid7()} toolName={tool.function.name} />);

          setAccumulatedMessages((prev) => [...prev, ...toolBlocks]);
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
    },
    [flushStream],
  );

  const handleSubmit = useCallback(
    async (data: FormData, e?: FormEvent<HTMLFormElement>) => {
      const success = await onSubmit?.(data, e);

      if (success === true) {
        try {
          const block = <UserMessage key={uuid7()} content={data.message} />;

          setAccumulatedMessages((prev) => [...prev, block]);
        } catch (err) {
          console.error('Error inserting user block', err);
        }
      }

      return success;
    },
    [onSubmit],
  );

  const handleFinished = useCallback(() => {
    const lastChannel = lastChannelRef.current;

    if (lastChannel != null) {
      flushStream(lastChannel);
    }
  }, [flushStream]);

  useEffect(() => {
    if (!readable) {
      return;
    }

    const processor = createStreamProcessor(readable, handleFrameChunk, handleFinished);

    processor.start();

    return () => {
      processor.cancel();
    };
  }, [readable, handleFinished, handleFrameChunk]);

  const renderedMessages = useMemo(
    () => messages?.map((message) => <ChatMessage key={uuid7()} {...message} />),
    [messages],
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
            flex flex-col gap-4 flex-1 min-h-0 overflow-y-scroll p-4 pb-8
            [mask-image:linear-gradient(to_top,transparent,hsl(0_0%_100%)_2rem)]
            [mask-repeat:no-repeat] [mask-size:100%_100%]
            [-webkit-mask-image:linear-gradient(to_top,transparent,hsl(0_0%_100%)_2rem)]
            [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:100%_100%]
          "
        >
          {renderedMessages}

          {accumulatedMessages}

          <ThinkBlock
            renderEmptyContent={true}
            defaultExpanded={true}
            ref={thinkBlockRef}
            streamingRef={thinkStreamingRef}
          />

          <AssistantMessage renderEmptyContent={true} ref={textBlockRef} streamingRef={textStreamingRef} />
        </div>
      )}

      <div className="p-4 pt-4 pl-1 w-full relative">
        {(loading || streaming) && <ChatLoader />}

        <ChatInput loading={loading} streaming={streaming} onSubmit={handleSubmit} {...chatInputProps} />
      </div>
    </div>
  );
}

function createStreamProcessor(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: Decoded) => void,
  onFinished: () => void,
) {
  const decoder = new FrameDecoder();
  const abortController = new AbortController();

  const start = async () => {
    try {
      const frameTransformer = new TransformStream<Uint8Array, Decoded>({
        transform(chunk, controller) {
          const decodedFrames = decoder.push(chunk);

          for (const frame of decodedFrames) {
            controller.enqueue(frame);
          }
        },
        flush(controller) {
          if (decoder.hasBufferedData()) {
            controller.error(new Error('Stream ended with an incomplete frame'));
          }
        },
      });

      const frameStream = stream.pipeThrough(frameTransformer);
      const reader = frameStream.getReader();

      while (true) {
        if (abortController.signal.aborted) {
          await reader.cancel('Aborted by new stream or unmount');

          break;
        }

        const { done, value } = await reader.read();

        if (done) {
          break; // Stream finished successfully
        }

        onChunk(value);
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Stream processing error:', error);
      }
    } finally {
      onFinished();
    }
  };

  return {
    start,
    cancel: () => abortController.abort(),
  };
}
