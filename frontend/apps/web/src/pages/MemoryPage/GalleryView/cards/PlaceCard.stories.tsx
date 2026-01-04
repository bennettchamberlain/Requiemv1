import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { makeFragmentData } from '@/graphql';

import { SearchGrid } from '../SearchGrid';

import { PlaceCard, PLACE_FRAGMENT } from './PlaceCard';

type StoryProps = ComponentProps<typeof PlaceCard> & {
  name: string;
  description: string;
};

const meta: Meta<StoryProps> = {
  component: PlaceCard,

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
    name: 'Central Park',
    description: 'A large public park in New York City.',
    onClick: fn(),
  },

  render: (args) => {
    const place = {
      __typename: 'PlaceType' as const,
      id: 'mock-id-1',
      name: args.name,
      description: args.description,
    };

    const maskedPlace = makeFragmentData(place, PLACE_FRAGMENT);

    return (
      <SearchGrid>
        <PlaceCard place={maskedPlace} onClick={args.onClick} />
      </SearchGrid>
    );
  },
};
