import { type ComponentProps, useEffect, useMemo } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { Chat } from './Chat';

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

const LORUM = (
  <>
    <p>
      Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed dignissim at nibh eget viverra. Fusce sed
      mi risus. Nullam ut sem sit amet turpis lacinia laoreet non non erat. Suspendisse viverra, magna ac
      cursus volutpat, tellus ipsum finibus eros, a commodo purus erat a neque. Etiam eget egestas orci.
    </p>

    <p>
      Vestibulum ante ipsum primis in faucibus orci luctus et ultrices posuere cubilia curae; Duis consequat
      sapien ut lacinia feugiat. Nulla et sollicitudin nisl. Ut at purus malesuada, finibus nulla at, dictum
      augue. Curabitur eget malesuada leo, eu euismod nibh. Maecenas tincidunt faucibus hendrerit.
    </p>

    <p>
      Pellentesque nec bibendum nunc, vel elementum nisi. Aenean feugiat dapibus dui, nec commodo dolor dictum
      nec. Donec sit amet accumsan ligula. Suspendisse a felis ac justo tempor cursus. Cras a tincidunt eros,
      ac tincidunt lacus. Aliquam erat volutpat.
    </p>

    <p>
      Integer at scelerisque arcu. Suspendisse dapibus, metus sed malesuada fringilla, lectus ligula pretium
      massa, ut maximus nunc eros sit amet justo. Morbi euismod, ipsum ut luctus porttitor, felis quam
      malesuada augue, eget pharetra massa mi et purus. Ut id cursus lorem.
    </p>

    <p>
      Donec in nisi sapien. Proin nec faucibus nunc. Aliquam at nisl sed ligula tincidunt ullamcorper. Mauris
      sed est id mauris egestas congue non eu lectus. Nam blandit feugiat purus, sit amet faucibus nulla
      vulputate ut. Suspendisse venenatis turpis vel nibh scelerisque, vitae condimentum felis pretium.
    </p>

    <p>
      Curabitur facilisis neque a nisl sollicitudin, sit amet pulvinar nibh cursus. Nulla vitae facilisis
      nulla. Etiam lacinia, sapien a laoreet gravida, nisl urna lacinia sem, vitae vestibulum elit mauris at
      erat. Phasellus nec suscipit mi, vel rhoncus ipsum. Sed id mi id sapien bibendum convallis.
    </p>

    <p>
      Mauris posuere libero sit amet faucibus viverra. Pellentesque et vestibulum nulla. Suspendisse ultricies
      risus nec dapibus efficitur. Vivamus at metus fermentum, luctus sem ut, sagittis eros. Aenean mattis
      dolor eu libero euismod, sit amet gravida elit lacinia. Quisque nec nulla nec arcu porta interdum.
    </p>

    <p>
      Ut consectetur, sem et pulvinar feugiat, erat nibh vehicula nulla, ut tincidunt nunc odio eu nisl.
      Vivamus vestibulum urna in dolor varius viverra. Morbi eget magna eu ligula scelerisque porttitor. Duis
      bibendum faucibus metus, in ultrices lorem ullamcorper nec. Proin viverra diam quis magna porttitor
      pretium.
    </p>

    <p>
      Sed sit amet feugiat nulla. Duis quis sapien et ipsum ultricies faucibus sit amet ac felis. Nullam vel
      est tincidunt, dapibus ligula eu, congue odio. Vestibulum aliquet nisi eu nunc cursus, non hendrerit
      risus venenatis. Curabitur id ipsum at libero consectetur suscipit ac id nibh.
    </p>

    <p>
      Praesent nec tristique lacus. Suspendisse nec tellus ac augue volutpat sagittis. Proin accumsan lacinia
      nibh nec bibendum. Nunc ac nunc sed risus feugiat ullamcorper. Integer imperdiet quam nec mi pulvinar,
      sit amet volutpat nibh congue. Morbi ornare orci sed diam elementum, id gravida elit ullamcorper.
    </p>

    <p>
      Nam eu augue non justo eleifend accumsan. Integer in sapien vel turpis elementum porta. In at justo nec
      justo pulvinar vulputate. Nullam at dignissim ex. Fusce vel orci id ex lacinia fermentum. Sed sed mi
      vitae nibh vehicula blandit. Suspendisse et neque vel nulla pulvinar gravida.
    </p>

    <p>
      Vivamus nec orci sit amet ligula venenatis tincidunt. Sed vitae nunc sit amet nibh mattis laoreet.
      Integer finibus posuere metus, sit amet dictum mi feugiat sed. Suspendisse nec risus varius, ultrices
      lacus vel, facilisis urna. Duis fermentum metus et velit facilisis, eget sodales lorem pulvinar.
    </p>

    <p>
      Morbi non leo ac nunc malesuada vehicula. Proin scelerisque purus vitae dolor venenatis dapibus. Nullam
      in purus ut ligula luctus egestas. Cras ac diam justo. Nullam venenatis erat in ligula vulputate, a
      suscipit eros feugiat. Vestibulum vel lorem et metus egestas mattis.
    </p>

    <p>
      Sed vitae justo at libero tristique rhoncus. Donec sit amet ante ac magna lacinia congue. Fusce
      condimentum tortor nec sapien malesuada faucibus. Aliquam erat volutpat. Maecenas blandit, est sed
      varius tincidunt, justo urna feugiat erat, at volutpat lectus erat sed mauris.
    </p>

    <p>
      Donec id nisl sit amet leo lacinia finibus. Nunc commodo, felis at congue pulvinar, turpis nulla varius
      justo, sit amet tristique mi nisl vel nunc. Etiam imperdiet erat at tellus viverra condimentum. In sed
      nunc gravida, convallis elit in, dictum erat. Quisque ultricies quam non ligula tincidunt pretium.
    </p>

    <p>
      Praesent dignissim purus in lectus sagittis suscipit. Vivamus volutpat risus at felis egestas porta.
      Suspendisse vel faucibus augue, ac accumsan odio. Sed porttitor augue sed odio vulputate pretium. Etiam
      scelerisque erat eu lorem bibendum, vitae pharetra leo sagittis.
    </p>

    <p>
      Aliquam malesuada nulla sed est ullamcorper, eu ultrices nunc dignissim. In ultricies, ligula et
      ultricies sagittis, turpis nulla dapibus nulla, vitae bibendum quam sapien eget leo. Sed in ligula nec
      turpis dignissim tincidunt. Curabitur ullamcorper, mauris id laoreet viverra, nulla arcu maximus nisl,
      vitae condimentum turpis urna at nulla.
    </p>

    <p>
      Aenean ac neque at mauris vehicula porttitor. Suspendisse egestas felis nec ligula vulputate, in
      venenatis arcu dapibus. Proin rhoncus magna et mauris dapibus posuere. Integer nec lorem sed erat
      aliquam imperdiet. Phasellus fermentum neque ac enim varius, a posuere tortor eleifend.
    </p>

    <p>
      Curabitur ac ipsum non sapien hendrerit fermentum. Pellentesque sodales nunc ac purus elementum, et
      malesuada risus porta. Vestibulum at ante feugiat, tincidunt orci sed, varius lacus. Morbi porttitor
      justo sit amet tristique tincidunt. Fusce euismod lorem ac ligula sodales hendrerit.
    </p>

    <p>
      Phasellus eu felis eget nunc dapibus gravida. Suspendisse potenti. Etiam varius, nisl ut viverra
      condimentum, magna erat scelerisque velit, eget efficitur nunc lacus nec urna. Duis eu mauris libero.
      Aenean sit amet ex velit. Mauris mattis malesuada justo vitae volutpat.
    </p>
  </>
);

function makeTextChannel() {
  const channel = new TransformStream<string, string>();
  const writer = channel.writable.getWriter();

  return {
    readable: channel.readable,
    write: (s: string) => writer.write(s),
    close: () => writer.close(),
    abort: (reason?: unknown) => writer.abort?.(reason),
  };
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
      const channel = useMemo(() => makeTextChannel(), []);

      useEffect(() => {
        let i = 1;

        const id = setInterval(() => {
          channel.write(`line ${i++} — ${new Date().toLocaleTimeString()}\n`);
        }, 25);

        return () => {
          clearInterval(id);
          channel.close();
        };
      }, [channel]);

      return <Story args={{ ...ctx.args, readable: channel.readable }} />;
    },
  ],
};

export const StreamingTextWithPriorMessages: Story = {
  decorators: [
    (Story, ctx) => {
      const channel = useMemo(() => makeTextChannel(), []);

      useEffect(() => {
        let i = 1;

        const id = setInterval(() => {
          channel.write(`line ${i++} — ${new Date().toLocaleTimeString()}\n`);
        }, 25);

        return () => {
          clearInterval(id);
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
      {
        role: 'user',
        content: 'May you please infinitely stream text content in the format:\n\nline # — H:MM:SS',
      },
    ],
  },
};
