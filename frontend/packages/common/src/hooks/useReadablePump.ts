

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

type Options = {
  /** read pauses when bufferSize >= highWaterMark */
  highWaterMark?: number;
  /** optional hard cap to avoid unbounded memory; default = Infinity */
  maxBuffer?: number;
  /** called when maxBuffer is exceeded (we drop newest by default) */
  onOverflow?: (size: number) => void;
};

/**
 * Keep one reader alive across re-renders; buffer when onChunk() can't consume.
 * Returns a stable `drain()` you can call (e.g., after a ref mounts) to replay.
 */
export function useReadablePump<T>(
  readable: ReadableStream<T> | null,
  onChunk: (v: T) => boolean,
  opts: Options = {},
) {
  const { highWaterMark = 32, maxBuffer = Number.POSITIVE_INFINITY, onOverflow } = opts;

  // Stable handler that always points to latest onChunk
  const onChunkEvent = useEvent(onChunk);

  // Reader & loop control
  const readerRef = useRef<ReadableStreamDefaultReader<T> | null>(null);
  const readingRef = useRef(false);
  const doneRef = useRef(false);

  // Ring-buffer-ish: array + head index (avoid O(n) shift)
  const bufRef = useRef<T[]>([]);
  const headRef = useRef(0);
  const size = () => bufRef.current.length - headRef.current;
  const peek = () => bufRef.current[headRef.current];
  const dropHead = () => {
    headRef.current++;
    // compact occasionally to keep array bounded
    if (headRef.current > 1024 && headRef.current * 2 > bufRef.current.length) {
      bufRef.current = bufRef.current.slice(headRef.current);
      headRef.current = 0;
    }
  };
  const enqueue = (v: T) => {
    bufRef.current.push(v);
    if (size() > maxBuffer) {
      onOverflow?.(size());
      // drop newest (or change policy to drop oldest)
      bufRef.current.pop();
    }
  };

  // Try to flush as many buffered items as the consumer accepts
  const drain = useCallback(() => {
    let delivered = 0;
    while (size() > 0) {
      const ok = onChunkEvent(peek());
      if (!ok) break;
      dropHead();
      delivered++;
    }
    // If we freed capacity and the reader is idle, kick the read loop
    if (delivered > 0 && !readingRef.current && !doneRef.current && size() < highWaterMark) {
      readNext();
    }
    return delivered;
  }, [onChunkEvent, highWaterMark]);

  // Define once; only touches refs
  const readNext = useCallback(() => {
    if (readingRef.current || doneRef.current) return;
    const reader = readerRef.current;
    if (!reader) return;

    // Backpressure: don't read if buffer is at/above HWM
    if (size() >= highWaterMark) return;

    readingRef.current = true;
    void reader.read().then(
      ({ done, value }) => {
        readingRef.current = false;

        if (done) {
          doneRef.current = true;
          try {
            reader.releaseLock();
          } catch {}
          readerRef.current = null;
          // Final attempt to drain leftover buffered items
          drain();
          return;
        }

        // First offer directly to the consumer; fallback to buffer if rejected
        const accepted = onChunkEvent(value as T);
        if (!accepted) enqueue(value as T);

        // Always try to drain buffered backlog (cheap; stops on first rejection)
        drain();

        // Continue pulling as long as we have capacity
        readNext();
      },
      (_err) => {
        // Treat read errors as terminal for this pump; release lock.
        readingRef.current = false;
        doneRef.current = true;
        try {
          reader?.releaseLock();
        } catch {}
        readerRef.current = null;
      },
    );
  }, [drain, highWaterMark, onChunkEvent]);

  useEffect(() => {
    if (!readable) return;
    if (readerRef.current) return; // already pumping this stream

    const reader = readable.getReader();
    readerRef.current = reader;
    readingRef.current = false;
    doneRef.current = false;

    // Kick the loop (respects HWM immediately)
    readNext();

    // No cleanup: we do NOT cancel on rerender; old reader persists until EOF.
    // If you ever switch to a new `readable`, you'll want policy to end the old one.
  }, [readable, readNext]);

  // If the onChunk implementation changes (e.g., your target ref mounted),
  // give it a chance to consume buffered items immediately.
  useLayoutEffect(() => {
    if (size() > 0) drain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChunk]); // depend on the raw prop, not the stable wrapper

  return {
    drain, // call this when your sink becomes ready (e.g., in a ref callback)
    get bufferSize() {
      return size();
    },
    isReading: () => readingRef.current && !!readerRef.current,
  };
}

function useEvent<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef(fn);

  useLayoutEffect(() => {
    ref.current = fn;
  }, [fn]);

  return useCallback(((...args: any[]) => ref.current(...args)) as T, []);
}
