/**
 * The chat stream's retry/backoff state machine: reads frames off a
 * ReadableStream, hands each to `onChunk`, and on a `false` return replays the
 * SAME chunk with exponentially increasing delay rather than dropping it or
 * moving on. Pure logic (no DOM), so this runs in the node project.
 */
import { describe, expect, it, vi } from 'vitest';

import { createStreamProcessor } from './createStreamProcessor';
import { FrameEncoder } from './FrameEncoder';
import { Channel, type Decoded } from './types';

const text = (payload: Uint8Array) => new TextDecoder().decode(payload);

/** A ReadableStream that yields the given chunks, one per pull, then closes. */
function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;

  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

describe('createStreamProcessor', () => {
  it('decodes each frame in order and finishes cleanly', async () => {
    const enc = new FrameEncoder();
    const stream = streamOf([enc.encodeFrame(Channel.TEXT, 'one'), enc.encodeFrame(Channel.THINK, 'two')]);

    const seen: Array<{ channel: Channel; text: string }> = [];
    const onFinished = vi.fn();
    const onError = vi.fn();

    const processor = createStreamProcessor({
      stream,
      onChunk: async (chunk) => {
        seen.push({ channel: chunk.channel, text: text(chunk.payload) });

        return true;
      },
      onFinished,
      onError,
    });

    await processor.start();

    expect(seen).toEqual([
      { channel: Channel.TEXT, text: 'one' },
      { channel: Channel.THINK, text: 'two' },
    ]);
    expect(onError).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('replays the same chunk with exponentially increasing delay until it succeeds', async () => {
    const frame = new FrameEncoder().encodeFrame(Channel.TEXT, 'hi');
    const stream = streamOf([frame]);

    let attempts = 0;
    const onChunk = vi.fn(async (chunk: Decoded) => {
      attempts += 1;
      expect(text(chunk.payload)).toBe('hi'); // the exact same chunk every time, not a fresh read

      return attempts > 2; // fail twice, then succeed
    });

    // Record the requested backoff delay but fire (near-)immediately so the
    // test doesn't actually wait out the schedule.
    const realSetTimeout = globalThis.setTimeout;
    const delays: number[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
      delays.push(ms ?? 0);

      return realSetTimeout(cb, 0);
    }) as typeof setTimeout);

    const onFinished = vi.fn();
    const onError = vi.fn();

    const processor = createStreamProcessor({
      stream,
      onChunk,
      onFinished,
      onError,
      retries: 5,
      initialDelay: 10,
      factor: 2,
      maxDelay: 1000,
    });

    await processor.start();

    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([10, 20]); // 10, then 10*factor
    expect(onError).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('caps the backoff delay at maxDelay', async () => {
    const frame = new FrameEncoder().encodeFrame(Channel.TEXT, 'hi');
    const stream = streamOf([frame]);

    let attempts = 0;
    const onChunk = vi.fn(async () => {
      attempts += 1;

      return attempts > 4; // fail four times, so the delay would exceed maxDelay without the cap
    });

    const realSetTimeout = globalThis.setTimeout;
    const delays: number[] = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void, ms?: number) => {
      delays.push(ms ?? 0);

      return realSetTimeout(cb, 0);
    }) as typeof setTimeout);

    const processor = createStreamProcessor({
      stream,
      onChunk,
      retries: 10,
      initialDelay: 10,
      factor: 3,
      maxDelay: 50,
    });

    await processor.start();

    // 10, 30, 50 (capped from 90), 50 (capped from 150) — never grows past maxDelay.
    expect(delays).toEqual([10, 30, 50, 50]);
  });

  it('gives up after the retry budget is exhausted and reports the failure', async () => {
    const frame = new FrameEncoder().encodeFrame(Channel.TEXT, 'hi');
    const stream = streamOf([frame]);

    const onChunk = vi.fn(async () => false); // never succeeds
    const onFinished = vi.fn();
    const onError = vi.fn();

    const processor = createStreamProcessor({
      stream,
      onChunk,
      onFinished,
      onError,
      retries: 2,
      initialDelay: 1,
      factor: 1,
      maxDelay: 1,
    });

    await processor.start();

    // One initial attempt plus `retries` replays.
    expect(onChunk).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    const [error] = onError.mock.calls[0] as [Error];
    expect(error.message).toMatch(/failed for a chunk after 2 retries/i);
    // The failure still reaches onFinished — callers can't get stuck spinning.
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops mid-stream without being reported as an error', async () => {
    const enc = new FrameEncoder();
    const stream = streamOf([enc.encodeFrame(Channel.TEXT, 'one'), enc.encodeFrame(Channel.TEXT, 'two')]);

    const seen: string[] = [];
    const onFinished = vi.fn();
    const onError = vi.fn();

    const processor = createStreamProcessor({
      stream,
      onChunk: async (chunk) => {
        seen.push(text(chunk.payload));
        // Abort as soon as the first frame lands — mirrors leaving the thread
        // mid-response.
        processor.cancel();

        return true;
      },
      onFinished,
      onError,
    });

    await processor.start();

    expect(seen).toEqual(['one']); // the second frame is never read
    expect(onError).not.toHaveBeenCalled();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('reports an error when the stream ends mid-frame instead of silently dropping it', async () => {
    const frame = new FrameEncoder().encodeFrame(Channel.TEXT, 'streamed');
    const truncated = frame.slice(0, frame.length - 2); // header + partial payload, no full frame ever arrives

    const stream = streamOf([truncated]);
    const onChunk = vi.fn(async () => true);
    const onFinished = vi.fn();
    const onError = vi.fn();

    const processor = createStreamProcessor({ stream, onChunk, onFinished, onError });

    await processor.start();

    expect(onChunk).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    const [error] = onError.mock.calls[0] as [Error];
    expect(error.message).toMatch(/incomplete frame/i);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
