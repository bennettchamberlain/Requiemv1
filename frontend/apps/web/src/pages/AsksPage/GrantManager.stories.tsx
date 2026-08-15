import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { GrantManager } from './GrantManager';

const meta: Meta<typeof GrantManager> = {
  title: 'Asks/Grant Manager',
  component: GrantManager,
  parameters: { layout: 'padded' },
  args: { onChangeMode: fn(), onRevoke: fn(), onAddGrant: fn(), onOpenHistory: fn() },
};

export default meta;
type Story = StoryObj<typeof GrantManager>;

export const Household: Story = {
  args: {
    groups: [
      {
        id: 'sam',
        name: 'Sam',
        tier: 'family',
        grants: [
          { id: 'g1', label: 'Photos & albums', mode: 'auto' },
          { id: 'g2', label: 'Calendar · busy/free', mode: 'auto' },
          { id: 'g3', label: 'Household documents', mode: 'review' },
          { id: 'g4', label: 'Health', mode: 'block' },
        ],
      },
      {
        id: 'siblings',
        name: 'Siblings',
        tier: 'care circle',
        grants: [
          {
            id: 'g5',
            label: "Dad's activity",
            mode: 'auto',
            note: 'digest only · no location',
            expiresAt: 'Dec 2026',
          },
        ],
      },
    ],
  },
};
