import type { ComponentProps } from 'react';

import { Input } from '@ci/shadcn';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { SearchBox } from './SearchBox';

type Props = ComponentProps<typeof SearchBox>;

const meta: Meta<Props> = {
  component: SearchBox,
  parameters: {
    layout: 'centered',
  },
  args: {
    onSearch: fn(),
  },
  decorators: [(Story) => <Story />],
};

export default meta;

type Story = StoryObj<Props>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    loading: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
};

export const NextToShadCNInput: Story = {
  decorators: [
    (Story) => (
      <div className="flex flex-row items-center gap-4 w-full max-w-md">
        <Input placeholder="Enter text here..." className="flex-1" />
        <Story />
      </div>
    ),
  ],
};
