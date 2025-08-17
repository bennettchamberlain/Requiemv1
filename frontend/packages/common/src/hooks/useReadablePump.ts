import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

export function useReadablePump<T>(readable: ReadableStream<T> | null, onChunk: (v: T) => boolean) {
  const onChunkEvent = useEvent(onChunk);

  const readerRef = useRef<ReadableStreamDefaultReader<T> | null>(null);
  const readingRef = useRef(false);
  const doneRef = useRef(false);

  const bufRef = useRef<T[]>([]);
  const headRef = useRef(0);
  const size = () => bufRef.current.length - headRef.current;
  const peek = () => bufRef.current[headRef.current];

  const dropHead = () => {
    headRef.current++;

    if (headRef.current > 1024 && headRef.current * 2 > bufRef.current.length) {
      // compact already-consumed items only
      bufRef.current = bufRef.current.slice(headRef.current);
      headRef.current = 0;
    }
  };

  const enqueue = (v: T) => {
    bufRef.current.push(v);
  };

  const startLoopRef = useRef<() => void>(() => {});

  const drain = useCallback(() => {
    let delivered = 0;

    while (size() > 0) {
      const ok = onChunkEvent(peek());

      if (!ok) {
        break;
      }

      dropHead();
      delivered++;
    }

    // Resume reading if backlog cleared and we're idle (paused).
    if (size() === 0 && !readingRef.current && !doneRef.current) {
      startLoopRef.current();
    }

    return delivered;
  }, [onChunkEvent]);

  const startLoop = useCallback(async () => {
    if (readingRef.current || doneRef.current || !readerRef.current) {
      return;
    }

    const reader = readerRef.current;
    readingRef.current = true;

    try {
      while (true) {
        // Pause when backlog exists; resume via drain()
        if (size() > 0) {
          break;
        }

        const { done, value } = await reader!.read();

        if (done) {
          doneRef.current = true;

          break;
        }

        const accepted = onChunkEvent(value as T);

        if (!accepted) {
          enqueue(value as T);

          break; // pause until drain() frees space
        }

        // Try flushing any newly acceptable buffered items (usually none)
        drain();
      }
    } catch {
      doneRef.current = true;
    } finally {
      readingRef.current = false;

      if (doneRef.current) {
        try {
          reader?.releaseLock();
        } catch {
          void 0;
        }

        readerRef.current = null;
        drain(); // final flush on EOF/error
      }

      // If merely paused, we keep the lock and wait for drain() to call startLoop() again.
    }
  }, [drain, onChunkEvent]);

  useEffect(() => {
    startLoopRef.current = startLoop;
  }, [startLoop]);

  useEffect(() => {
    if (!readable) {
      return;
    }

    if (readerRef.current) {
      return;
    } // already pumping this stream

    readerRef.current = readable.getReader();
    readingRef.current = false;
    doneRef.current = false;

    startLoop();
  }, [readable, startLoop]);

  useLayoutEffect(() => {
    if (size() > 0) {
      drain();
    }
  }, [onChunk]);

  return {
    drain,
    get bufferSize() {
      return size();
    },
    isReading: () => readingRef.current && !!readerRef.current,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function useEvent<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);

  useLayoutEffect(() => {
    ref.current = fn;
  }, [fn]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useCallback(((...args: any[]) => ref.current(...args)) as T, []);
}
