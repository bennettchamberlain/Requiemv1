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
    decision: 'covered-review',
    prompt: 'Do you have photos of us from the lake trip?',
    scopeSummary: 'Photos · 12–15 June · people: Maya, Sam, Leo, Mia',
    // The real string `searchBreadthNote` produces. A story that invents a
    // narrower one would document a card this page cannot render.
    searchBreadth:
      '“photos” is a label on the request, not a guaranteed filter — unless your Companion recognises it, this searches every kind of thing in your memory.',
    items: [
      { id: '1', type: 'photo', label: 'Lake, morning swim' },
      { id: '2', type: 'photo', label: 'Dock at sunset' },
      { id: '3', type: 'photo', label: 'Leo on the kayak', withheld: true },
      { id: '4', type: 'photo', label: 'Campfire' },
    ],
    downgrades: ['attribute', 'boolean'],
  },
};

/** No standing grant — quarantined, with a coarser answer offered instead. */
export const UnknownAsker: Story = {
  args: {
    askerName: 'Unknown asker',
    tier: 'no standing grant',
    decision: 'unreviewed',
    prompt: 'Where do you live?',
    scopeSummary: 'location · location',
    searchBreadth:
      '“location” is a label on the request, not a guaranteed filter — unless your Companion recognises it, this searches every kind of thing in your memory.',
    downgrades: ['attribute', 'existence', 'boolean'],
  },
};

/**
 * Already authorized by a standing grant. Nothing here is waiting on the
 * owner's permission — only on the answer being produced.
 */
export const PreAuthorized: Story = {
  args: {
    askerName: 'Sam',
    tier: 'known contact',
    decision: 'pre-authorized',
    prompt: 'Are you free Thursday evening?',
    scopeSummary: 'availability',
    searchBreadth: 'This ask names no data class, so it searches every kind of thing in your memory.',
    downgrades: ['existence', 'boolean'],
  },
};

/** A form that discloses no items at all — only a yes/no is on offer. */
export const BooleanOnly: Story = {
  args: {
    askerName: 'Devon',
    tier: 'known contact',
    decision: 'covered-review',
    prompt: 'Do you know Carol Chen?',
    scopeSummary: 'relationship',
    searchBreadth: 'This ask names no data class, so it searches every kind of thing in your memory.',
    downgrades: ['boolean'],
  },
};
