import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { makeFragmentData } from '@/graphql';

import { SearchGrid } from '../SearchGrid';

import { BrowserActivityCard, BROWSER_ACTIVITY_FRAGMENT } from './BrowserActivityCard';

type StoryProps = ComponentProps<typeof BrowserActivityCard> & {
  title: string;
  url: string;
};

const meta: Meta<StoryProps> = {
  component: BrowserActivityCard,

  parameters: {
    layout: 'centered',
  },

  argTypes: {
    title: {
      control: 'text',
    },

    url: {
      control: 'text',
    },
  },
};

export default meta;

type Story = StoryObj<StoryProps>;

export const Default: Story = {
  args: {
    title: 'Sample title',
    url: 'https://example.com',
    onClick: fn(),
  },

  render: (args) => {
    const browserActivity = {
      __typename: 'BrowserActivityType' as const,
      id: 'mock-id-1',
      title: args.title,
      url: args.url,
    };

    const maskedBrowserActivity = makeFragmentData(browserActivity, BROWSER_ACTIVITY_FRAGMENT);

    return (
      <SearchGrid>
        <BrowserActivityCard browserActivity={maskedBrowserActivity} onClick={args.onClick} />
      </SearchGrid>
    );
  },
};
