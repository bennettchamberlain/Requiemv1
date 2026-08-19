import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { AskComposer } from './AskComposer';

const meta: Meta<typeof AskComposer> = {
  title: 'Asks/Composer',
  component: AskComposer,
  parameters: { layout: 'centered' },
  args: { onSend: fn() },
  decorators: [
    (Story) => (
      <div className="w-[440px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AskComposer>;

export const PhotosAsk: Story = {
  args: {
    recipientName: 'Sam',
    tier: 'family',
    initialPrompt: 'Do you have photos of us from the lake trip?',
    preview: [
      { label: 'Type', value: 'content → photos' },
      { label: 'Who', value: 'Maya, Sam, Leo, Mia' },
      { label: 'When', value: '12–15 June' },
    ],
  },
};

/** Availability — the archetype an assistant can drive without a human. */
export const AvailabilityAsk: Story = {
  args: {
    recipientName: 'Devon',
    tier: 'friend',
    autoAnswers: true,
    initialPrompt: 'Free for lunch Friday?',
    preview: [
      { label: 'Type', value: 'availability' },
      { label: 'Window', value: 'Fri 7 Aug · 11:00–14:00' },
      { label: 'Needs', value: '≥ 60 min free' },
    ],
  },
};
