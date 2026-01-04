import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { makeFragmentData } from '@/graphql';

import { SearchGrid } from '../SearchGrid';

import { FileCard, FILE_FRAGMENT } from './FileCard';

type StoryProps = ComponentProps<typeof FileCard> & {
  name: string;
};

const meta: Meta<StoryProps> = {
  component: FileCard,

  parameters: {
    layout: 'centered',
  },

  argTypes: {
    name: {
      control: 'text',
    },
  },
};

export default meta;

type Story = StoryObj<StoryProps>;

export const Default: Story = {
  args: {
    name: 'Sample file',
    onClick: fn(),
  },

  render: (args) => {
    const file = {
      __typename: 'FileType' as const,
      id: 'mock-id-1',
      url: 'https://images.unsplash.com/photo-1656543802898-41c8c46683a7?q=80&w=1471&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    };

    const maskedFile = makeFragmentData(file, FILE_FRAGMENT);

    return (
      <SearchGrid>
        <FileCard file={maskedFile} onClick={args.onClick} />
      </SearchGrid>
    );
  },
};
