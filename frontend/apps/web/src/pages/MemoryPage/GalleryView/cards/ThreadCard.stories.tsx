import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { makeFragmentData } from '@/graphql';

import { SearchGrid } from '../SearchGrid';

import { ThreadCard, THREAD_FRAGMENT } from './ThreadCard';

type StoryProps = ComponentProps<typeof ThreadCard> & {
  name: string;
  description: string;
};

const meta: Meta<StoryProps> = {
  component: ThreadCard,

  parameters: {
    layout: 'centered',
  },

  argTypes: {
    name: {
      control: 'text',
    },

    description: {
      control: 'text',
    },
  },
};

export default meta;

type Story = StoryObj<StoryProps>;

export const Default: Story = {
  args: {
    name: 'Planning Project X',
    description: 'Thinking through the next planning steps for Project X.',
    onClick: fn(),
  },

  render: (args) => {
    const thread = {
      __typename: 'ThreadType' as const,
      id: 'mock-id-1',
      name: args.name,
      description: args.description,
    };

    const maskedThread = makeFragmentData(thread, THREAD_FRAGMENT);

    return (
      <SearchGrid>
        <ThreadCard thread={maskedThread} onClick={args.onClick} />
      </SearchGrid>
    );
  },
};
