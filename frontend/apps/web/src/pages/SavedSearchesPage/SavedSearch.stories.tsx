import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { mockSavedSearch } from './_storyHelpers';
import { SavedSearch } from './SavedSearch';

const meta: Meta<typeof SavedSearch> = {
  title: 'Saved Search/Row',
  component: SavedSearch,
  parameters: { layout: 'padded' },
  args: {
    openSavedSearchEditModal: fn(),
    openSavedSearchShareModal: fn(),
    openSavedSearchDeleteModal: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-full max-w-4xl border-t border-border/50">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof SavedSearch>;

// Shared + filtered: the "Shared" badge and the filter-count chip both show.
export const SharedAndFiltered: Story = {
  args: { savedSearch: mockSavedSearch() },
};

export const Plain: Story = {
  args: {
    savedSearch: mockSavedSearch({
      name: 'Unread work email',
      isPublic: false,
      shareToken: null,
      filters: null,
      entityTypes: ['communication'],
    }),
  },
};
