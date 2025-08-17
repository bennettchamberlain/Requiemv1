import { useMemo, useRef } from 'react';

type SegType = 'text' | 'tool' | 'think';

type MultiplexResult = {
  text: ReadableStream<string>;
  tool: ReadableStream<string>;
  think: ReadableStream<string>;
  done: Promise<void>;
};

export function useMultiplexTaggedStream(
  source: ReadableStream<string> | null | undefined,
  onSegmentEnd?: (type: SegType) => void,
) {
  const cbRef = useRef(onSegmentEnd);
  cbRef.current = onSegmentEnd;

  // Construct only when `source` identity changes.
  const mux = useMemo(() => {
    if (!source) {
      return null;
    }

    return multiplexTaggedStream(source, (t) => cbRef.current?.(t));
  }, [source]);

  return mux; // { text, tool, think, done } | null
}

function multiplexTaggedStream(
  source: ReadableStream<string>,
  onSegmentEnd?: (type: SegType) => void,
): MultiplexResult {
  let mode: SegType = 'text';
  let emittedSinceLastEnd = false;

  const reader = source.getReader();

  // small helper to build an output stream
  const mkOut = () => {
    let ctrl: ReadableStreamDefaultController<string> | null = null;
    const stream = new ReadableStream<string>({
      start(c) {
        ctrl = c;
      },
    });

    return {
      stream,
      write: (s: string) => {
        if (s && ctrl) {
          ctrl.enqueue(s);
        }
      },
      close: () => {
        try {
          ctrl?.close?.();
        } catch {
          void 0;
        }
      },
      error: (e: unknown) => {
        try {
          ctrl?.error?.(e);
        } catch {
          void 0;
        }
      },
    };
  };

  const textOut = mkOut();
  const toolOut = mkOut();
  const thinkOut = mkOut();

  const writeToCurrent = (s: string) => {
    if (!s) {
      return;
    }

    emittedSinceLastEnd = true;
    if (mode === 'text') {
      textOut.write(s);
    } else if (mode === 'tool') {
      toolOut.write(s);
    } else {
      thinkOut.write(s);
    }
  };

  const endTextIfAny = () => {
    // Text has no explicit closing tag; treat boundary/EOF as close.
    if (mode === 'text' && emittedSinceLastEnd) {
      onSegmentEnd?.('text');
    }

    emittedSinceLastEnd = false;
  };

  const TAG_RE = /<\/?tool>|<\/?think>/g;

  let resolveDone!: () => void, rejectDone!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  // Keep a short tail so tags split across chunks are detected.
  let buf = '';
  const TAIL = 7; // longest tag length is 8 ("</think>")

  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }

        buf += value ?? '';

        TAG_RE.lastIndex = 0;
        let cursor = 0;

        for (;;) {
          const m = TAG_RE.exec(buf);
          if (!m) {
            break;
          }

          const tag = m[0];
          const tagStart = m.index;

          if (tagStart > cursor) {
            writeToCurrent(buf.slice(cursor, tagStart));
          }

          if (tag === '<tool>') {
            endTextIfAny(); // leaving text closes any emitted text segment
            mode = 'tool';
            emittedSinceLastEnd = false;
          } else if (tag === '</tool>') {
            if (mode === 'tool') {
              onSegmentEnd?.('tool');
            }

            mode = 'text';
            emittedSinceLastEnd = false;
          } else if (tag === '<think>') {
            endTextIfAny();
            mode = 'think';
            emittedSinceLastEnd = false;
          } else if (tag === '</think>') {
            if (mode === 'think') {
              onSegmentEnd?.('think');
            }

            mode = 'text';
            emittedSinceLastEnd = false;
          }

          cursor = TAG_RE.lastIndex;
        }

        if (cursor < buf.length) {
          const remaining = buf.slice(cursor);
          const hold = remaining.slice(-TAIL);
          const emitNow = remaining.slice(0, Math.max(0, remaining.length - TAIL));
          writeToCurrent(emitNow);
          buf = hold;
        } else {
          buf = buf.slice(-TAIL);
        }
      }

      // No more tags will appear; flush buffer.
      if (buf) {
        writeToCurrent(buf);
      }

      // EOF "closes" text if we emitted any since last boundary.
      endTextIfAny();

      textOut.close();
      toolOut.close();
      thinkOut.close();
      resolveDone();
    } catch (e) {
      // Propagate errors to all consumers
      textOut.error(e);
      toolOut.error(e);
      thinkOut.error(e);
      rejectDone(e);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        void 0;
      }
    }
  })();

  return { text: textOut.stream, tool: toolOut.stream, think: thinkOut.stream, done };
}
