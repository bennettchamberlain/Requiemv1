import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { AskReviewCard } from './AskReviewCard';

const meta: Meta<typeof AskReviewCard> = {
  title: 'Asks/Review Card',
  component: AskReviewCard,
  parameters: { layout: 'centered' },
  args: { onApprove: fn(), onDecline: fn(), onToggleItem: fn(), onDowngrade: fn() },
  decorators: [
    (Story) => (
      <div className="w-[440px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AskReviewCard>;

/** The everyday case: a household member asking for photos. */
export const HouseholdPhotos: Story = {
  args: {
    askerName: 'Maya',
    tier: 'family',
    prompt: 'Do you have photos of us from the lake trip?',
    scopeSummary: 'Photos · 12–15 June · people: Maya, Sam, Leo, Mia',
    items: [
      { id: '1', type: 'photo', label: 'Lake, morning swim' },
      { id: '2', type: 'photo', label: 'Dock at sunset' },
      { id: '3', type: 'photo', label: 'Leo on the kayak', withheld: true },
      { id: '4', type: 'photo', label: 'Campfire' },
    ],
    downgrades: ['summary', 'boolean'],
  },
};

/** No standing grant — quarantined, with a coarser answer offered instead. */
export const UnknownAsker: Story = {
  args: {
    askerName: 'Unknown asker',
    tier: 'stranger',
    prompt: 'Where do you live?',
    scopeSummary: 'Location · current address',
    unknownAsker: true,
    downgrades: ['summary', 'boolean', 'none'],
  },
};

/** A form that discloses no items at all — only a yes/no is on offer. */
export const BooleanOnly: Story = {
  args: {
    askerName: 'Devon',
    tier: 'friend',
    prompt: 'Do you know Carol Chen?',
    scopeSummary: 'Relationship · one person',
    downgrades: ['boolean'],
  },
};
