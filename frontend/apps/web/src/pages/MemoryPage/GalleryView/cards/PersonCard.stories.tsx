import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { makeFragmentData } from '@/graphql';

import { SearchGrid } from '../SearchGrid';

import { PersonCard, PERSON_FRAGMENT } from './PersonCard';

type StoryProps = ComponentProps<typeof PersonCard> & {
  name: string;
  description: string;
};

const meta: Meta<StoryProps> = {
  component: PersonCard,

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
    name: 'John Doe',
    description: 'A software engineer based in San Francisco.',
    onClick: fn(),
  },

  render: (args) => {
    const person = {
      __typename: 'PersonType' as const,
      id: 'mock-id-1',
      name: args.name,
      description: args.description,
    };

    const maskedPerson = makeFragmentData(person, PERSON_FRAGMENT);

    return (
      <SearchGrid>
        <PersonCard person={maskedPerson} onClick={args.onClick} />
      </SearchGrid>
    );
  },
};
