import { FrameDecoder } from './FrameDecoder';

import { type Decoded } from './types';

export function toFrameStream(source: ReadableStream<Uint8Array> | null): ReadableStream<Decoded> | null {
  if (source == null) {
    return null;
  }

  const dec = new FrameDecoder();
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  let pending: Decoded[] = [];

  return new ReadableStream<Decoded>({
    start() {
      reader = source.getReader();
    },
    async pull(controller) {
      // flush any decoded frames first
      if (pending.length) {
        controller.enqueue(pending.shift()!);

        return;
      }

      const { value, done } = await reader.read();

      if (done) {
        // if dec has leftover bytes here, the server sent a truncated frame
        controller.close();
        return;
      }

      if (value && value.byteLength) {
        pending = dec.push(value);
      }

      if (pending.length) {
        controller.enqueue(pending.shift()!);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } catch {
        void 0;
      }
    },
  });
}
