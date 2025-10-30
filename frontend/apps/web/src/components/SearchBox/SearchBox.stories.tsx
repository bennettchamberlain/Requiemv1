import type { ComponentProps } from 'react';

import { Input } from '@ci/shadcn';
import type { Meta, StoryObj } from '@storybook/react';

import { SearchBox } from './SearchBox';

type Props = ComponentProps<typeof SearchBox>;

const meta: Meta<Props> = {
  component: SearchBox,
  parameters: {
    layout: 'centered',
  },
  args: {},
  decorators: [(Story) => <Story />],
};

export default meta;

type Story = StoryObj<Props>;

export const Default: Story = {
  args: {},
};

export const NextToShadCNInput: Story = {
  args: {},
  decorators: [
    (Story) => (
      <div className="flex flex-row gap-4 w-full max-w-md">
        <Input placeholder="Enter text here..." className="flex-1" />
        <Story />
      </div>
    ),
  ],
};
