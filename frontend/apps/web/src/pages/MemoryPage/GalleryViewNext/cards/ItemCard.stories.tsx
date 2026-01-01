import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { makeFragmentData } from '@/graphql';

import { SearchGrid } from '../SearchGrid';

import { ItemCard, ITEM_FRAGMENT } from './ItemCard';

type StoryProps = ComponentProps<typeof ItemCard> & {
  name: string;
  description: string;
};

const meta: Meta<StoryProps> = {
  component: ItemCard,

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
    name: 'Sample Item',
    description: 'A sample item description',
    onClick: fn(),
  },

  render: (args) => {
    const item = {
      __typename: 'ItemType' as const,
      id: 'mock-id-1',
      name: args.name,
      description: args.description,
    };

    const maskedItem = makeFragmentData(item, ITEM_FRAGMENT);

    return (
      <SearchGrid>
        <ItemCard item={maskedItem} onClick={args.onClick} />
      </SearchGrid>
    );
  },
};

export const WithImage: Story = {
  args: {
    name: 'Sample item',
    onClick: fn(),
  },

  render: (args) => {
    const item = {
      __typename: 'ItemType' as const,
      id: 'mock-id-1',
      name: args.name,
      description: 'A sample item',
      file: {
        id: 'file-id-1',
        url: 'https://images.unsplash.com/photo-1656543802898-41c8c46683a7?q=80&w=1471&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
      },
    };

    const maskedItem = makeFragmentData(item, ITEM_FRAGMENT);

    return (
      <SearchGrid>
        <ItemCard item={maskedItem} onClick={args.onClick} />
      </SearchGrid>
    );
  },
};
