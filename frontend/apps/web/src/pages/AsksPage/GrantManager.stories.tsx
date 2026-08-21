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
          {
            id: 'g6',
            label: 'Location',
            mode: 'auto',
            revokedAt: '3 Aug 2026',
          },
        ],
      },
    ],
  },
};

/**
 * What the page actually renders today: no mode-change mutation is reachable
 * from the client, so the three mode buttons are inert and say so rather than
 * pretending to work.
 */
export const ModeChangesUnavailable: Story = {
  args: {
    ...Household.args,
    caveat: 'When a grant lapses isn’t on the wire yet, so no expiry date is shown here.',
  },
  // `onChangeMode` is supplied by `meta.args`, and Storybook's arg merge treats
  // an explicit `undefined` in a story as "leave it unset", not "remove it" —
  // which would silently render the WIRED state under an unwired story name.
  // Passing it at the call site is unambiguous.
  render: (args) => <GrantManager {...args} onChangeMode={undefined} />,
};
