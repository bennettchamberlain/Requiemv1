import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { makeFragmentData } from '@/graphql';

import { SearchGrid } from '../SearchGrid';

import { EventCard, EVENT_FRAGMENT } from './EventCard';

type StoryProps = ComponentProps<typeof EventCard> & {
  title: string;
  description: string;
};

const meta: Meta<StoryProps> = {
  component: EventCard,

  parameters: {
    layout: 'centered',
  },

  argTypes: {
    title: {
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
    title: 'New York City Marathon',
    description: 'An annual marathon held in New York City. Get psyched for the exercise!',
    onClick: fn(),
  },

  render: (args) => {
    const event = {
      __typename: 'EventType' as const,
      id: 'mock-id-1',
      title: args.title,
      description: args.description,
    };

    const maskedEvent = makeFragmentData(event, EVENT_FRAGMENT);

    return (
      <SearchGrid>
        <EventCard event={maskedEvent} onClick={args.onClick} />
      </SearchGrid>
    );
  },
};
