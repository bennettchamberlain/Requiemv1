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
  // These refs are used to point to the stream target for text coming from
  // the LLM endpoint.
  const textStreamingRef = useRef<HTMLDivElement | null>(null);
  const thinkStreamingRef = useRef<HTMLDivElement | null>(null);

  // We want to track the channel of the last message we've received.
  // If we receive a message in a new channel we'll know to kick off
  // the clone / swap flow.
  const lastChannelRef = useRef<number | null>(null);

  const renderStreamNodes = useCallback(
    () => (
      <>
        <ThinkBlock
          key={uuid7()}
          renderEmptyContent={true}
          defaultExpanded={true}
          streamingRef={thinkStreamingRef}
        />

        <AssistantMessage key={uuid7()} renderEmptyContent={true} streamingRef={textStreamingRef} />
      </>
    ),
    [],
  );

  const [streamNodes, setStreamNodes] = useState<ReactNode>(renderStreamNodes());
  const [accumulatedMessages, setAccumulatedMessages] = useState<ReactNode[]>([streamNodes]);

  const flushStream = useCallback(() => {
    const newStreamNodes = renderStreamNodes();

    setAccumulatedMessages((prev) => [...prev, newStreamNodes]);
    setStreamNodes(newStreamNodes);
  }, []);

  const appendMessage = useCallback((message: ReactNode) => {
    setAccumulatedMessages((prev) => [...prev, message]);
  }, []);

  const handleFrameChunk = useCallback(
    (chunk: Decoded) => {
      return false;

      if (!supportedChannels.has(chunk.channel)) {
        console.log('Ignored unsupported chunk channel:', chunk.channel);

        return true; // consumed → read next chunk
      }

      const lastChannel = lastChannelRef.current;
      const payload = textDecoder.decode(chunk.payload);

      lastChannelRef.current = chunk.channel;

      if (lastChannel != null && chunk.channel !== lastChannel) {
        flushStream();
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

          appendMessage(toolBlocks);
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

          appendMessage(block);
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
      flushStream();
    }
  }, [flushStream]);

  useEffect(() => {
    if (!readable) {
      return;
    }

    const processor = createStreamProcessor({
      stream: readable,
      onChunk: handleFrameChunk,
      onFinished: handleFinished,
    });

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
        </div>
      )}

      <div className="p-4 pt-4 pl-1 w-full relative">
        {(loading || streaming) && <ChatLoader />}

        <ChatInput loading={loading} streaming={streaming} onSubmit={handleSubmit} {...chatInputProps} />
      </div>
    </div>
  );
}

interface Options {
  stream: ReadableStream<Uint8Array>;
  onChunk: (chunk: Decoded) => boolean | Promise<boolean>;
  onFinished?: () => void;
  onError?: (error: unknown) => void;
  /** Maximum number of retry attempts. Set to Infinity for unlimited retries. */
  retries?: number;
  /** Initial delay in milliseconds. */
  initialDelay?: number;
  /** The factor by which the delay increases after each retry (e.g., 2 for doubling). */
  factor?: number;
  /** The maximum delay in milliseconds. */
  maxDelay?: number;
}

function createStreamProcessor({
  stream,
  onChunk,
  onFinished,
  onError,
  retries = 10,
  initialDelay = 10,
  factor = 2,
  maxDelay = 5000,
}: Options) {
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

      let chunkToReplay: Decoded | null = null;
      let retryCount = 0;
      let currentDelay = initialDelay;

      while (true) {
        if (abortController.signal.aborted) {
          await reader.cancel('Aborted by new stream or unmount');

          break;
        }

        let currentChunk: Decoded;

        if (chunkToReplay) {
          currentChunk = chunkToReplay;
        } else {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          currentChunk = value;
        }

        const success = await onChunk(currentChunk);

        if (success === false) {
          retryCount++;

          if (retryCount > retries) {
            throw new Error(`Processing failed for a chunk after ${retries} retries`);
          }

          console.warn(`Chunk processing failed. Retrying in ${currentDelay}ms (Attempt ${retryCount})`);

          await new Promise((resolve) => setTimeout(resolve, currentDelay));

          currentDelay = Math.min(maxDelay, currentDelay * factor);
          chunkToReplay = currentChunk;
        } else {
          chunkToReplay = null;
          retryCount = 0;
          currentDelay = initialDelay;
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        onError?.(err);
      }
    } finally {
      onFinished?.();
    }
  };

  return {
    start,
    cancel: () => abortController.abort(),
  };
}
