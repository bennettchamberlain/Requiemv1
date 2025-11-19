import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { action } from 'storybook/actions';
import { fn } from 'storybook/test';

import { UploadModal } from './UploadModal';

type Props = ComponentProps<typeof UploadModal>;

const meta: Meta<Props> = {
  component: UploadModal,
  parameters: {
    layout: 'centered',
  },
  args: {
    open: true,
    onSubmit: async (files: FileList) => {
      action('onSubmit')([files]);

      await new Promise((resolve) => setTimeout(resolve, 500));

      return true;
    },
    onClose: fn(),
  },
  decorators: [(Story) => <Story />],
};

export default meta;

type Story = StoryObj<Props>;

export const Default: Story = {};
