import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { AnswerCard } from './AnswerCard';

const meta: Meta<typeof AnswerCard> = {
  title: 'Asks/Answer Card',
  component: AnswerCard,
  parameters: { layout: 'centered' },
  args: { onSave: fn(), onThank: fn() },
  decorators: [
    (Story) => (
      <div className="w-[440px]">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AnswerCard>;

/** Reviewed by a human, with some items held back. */
export const ReviewedWithWithheld: Story = {
  args: {
    responderName: 'Sam',
    summary: 'Sam shared 3 items.',
    items: [
      { id: '1', type: 'photo', label: 'Lake, morning swim' },
      { id: '2', type: 'photo', label: 'Dock at sunset' },
      { id: '3', type: 'photo', label: 'Campfire' },
    ],
    disclosedCount: 3,
    withheldCount: 2,
    autoAnswered: false,
    consentBasis: 'your family grant',
  },
};

/** Auto-answered under a standing grant — the provenance must not claim review. */
export const AutoAnswered: Story = {
  args: {
    responderName: 'Devon',
    summary: 'Devon has 1 free slot Friday (longest 90 min).',
    disclosedCount: 1,
    withheldCount: 0,
    autoAnswered: true,
    consentBasis: 'your calendar grant',
  },
};

/** Clamped to a summary by the disclosure ceiling — no items travel. */
export const SummaryOnly: Story = {
  args: {
    responderName: 'Sam',
    summary: 'Sam has 4 matching items.',
    disclosedCount: 4,
    withheldCount: 0,
    autoAnswered: false,
    consentBasis: 'colleague tier',
  },
};
