import { type ComponentProps, useEffect, useMemo } from 'react';
import { Buffer } from 'buffer';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { Chat } from './Chat';
import { Channel, FrameEncoder } from './utils';

type Props = ComponentProps<typeof Chat>;

const meta: Meta<Props> = {
  component: Chat,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    onAttach: fn(),
    onRecord: fn(),
    onStop: fn(),
    onSubmit: fn(),
  },
  decorators: [
    (Story) => (
      <div className="h-screen overflow-hidden">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<Props>;

const frameEncoder = new FrameEncoder();

function makeByteChannel() {
  // Emits raw Uint8Array chunks; nothing else.
  const t = new TransformStream<Uint8Array, Uint8Array>();
  const writer = t.writable.getWriter();

  return {
    /** ReadableStream<Uint8Array> you can pass to your component (or decoder) */
    readable: t.readable,

    /** Write raw bytes. Buffer is a Uint8Array, so this works: write(Buffer.from(...)) */
    write: (u8: Uint8Array) => writer.write(u8),

    /** Close the stream */
    close: () => writer.close(),

    /** Abort the stream */
    abort: (reason?: unknown) => writer.abort?.(reason),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const Default: Story = {
  args: {
    messages: [
      {
        role: 'user',
        content:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\nSed dignissim at nibh eget viverra.\n\nFusce sed mi risus. Nullam ut sem sit amet turpis lacinia laoreet non non erat. Suspendisse viverra, magna accursus volutpat, tellus ipsum finibus eros, a commodo purus erat a neque. Etiam eget egestas orci.',
      },
      {
        role: 'tool',
        content: 'Foobar',
      },
      {
        role: 'assistant',
        content:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\nSed dignissim at nibh eget viverra.\n\nFusce sed mi risus. Nullam ut sem sit amet turpis lacinia laoreet non non erat. Suspendisse viverra, magna accursus volutpat, tellus ipsum finibus eros, a commodo purus erat a neque. Etiam eget egestas orci.',
      },
      {
        role: 'user',
        content:
          'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\nSed dignissim at nibh eget viverra.\n\nFusce sed mi risus. Nullam ut sem sit amet turpis lacinia laoreet non non erat. Suspendisse viverra, magna accursus volutpat, tellus ipsum finibus eros, a commodo purus erat a neque. Etiam eget egestas orci.',
      },
      {
        role: 'assistant',
        content:
          '<think>I am a helpful assistant, I can see what the user might be thinking. Hmmm... what lorem text to generate to help?</think>Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n\nSed dignissim at nibh eget viverra.\n\nFusce sed mi risus. Nullam ut sem sit amet turpis lacinia laoreet non non erat. Suspendisse viverra, magna accursus volutpat, tellus ipsum finibus eros, a commodo purus erat a neque. Etiam eget egestas orci.',
      },
    ],
    loading: false,
  },
};

export const WithoutChildren: Story = {
  args: {},
};

export const StreamingText: Story = {
  decorators: [
    (Story, ctx) => {
      const channel = useMemo(() => makeByteChannel(), []);

      async function* scriptedChunks() {
        const thinking = `Hmm... let me piece this together. I'm considering how the structure flows, and whether the sequence of tokens aligns with the intended pattern. It looks like there are multiple possible branches here, but one seems more consistent. If I break this down step by step, I should be able to maintain coherence. I might need to reconcile a few edge cases, but overall the direction seems clear. I'll refine the output so it's both logical and natural. Yes, I think this is the right path forward.`;

        for (const ch of thinking) {
          yield frameEncoder.encodeFrame(Channel.THINK, ch);

          await sleep(Math.floor(Math.random() * 5) + 5);
        }

        await sleep(500);

        yield frameEncoder.encodeFrame(
          Channel.TOOL,
          JSON.stringify([
            {
              function: {
                name: 'fetchTimeAwareness',
              },
            },
          ]),
        );

        await sleep(1500);

        yield frameEncoder.encodeFrame(
          Channel.TOOL,
          JSON.stringify([
            {
              function: {
                name: 'recombobulateBearings',
              },
            },
          ]),
        );

        await sleep(1500);

        for (let i = 0; i < 100; i++) {
          yield frameEncoder.encodeFrame(Channel.TEXT, `line ${i} — ${new Date().toLocaleTimeString()}\n`);

          await sleep(50);
        }
      }

      useEffect(() => {
        (async () => {
          for await (const chunk of scriptedChunks()) {
            channel.write(Buffer.from(chunk));
          }
        })();

        return () => {
          channel.close();
        };
      }, [channel]);

      return <Story args={{ ...ctx.args, readable: channel.readable }} />;
    },
  ],
  args: {
    messages: [
      {
        role: 'user',
        content: 'May you please generate some text content in the format:\n\nline # — H:MM:SS',
      },
    ],
  },
};
