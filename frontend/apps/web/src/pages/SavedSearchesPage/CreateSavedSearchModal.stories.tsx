import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { DropdownProvider } from '@/components/SearchBox/useDropdown';

import { withApollo } from './_storyHelpers';
import { CreateSavedSearchModal } from './CreateSavedSearchModal';

const meta: Meta<typeof CreateSavedSearchModal> = {
  title: 'Saved Search/Create Modal',
  component: CreateSavedSearchModal,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withApollo,
    (Story) => (
      <DropdownProvider args={[{ changeSearchParams: false }]}>
        <Story />
      </DropdownProvider>
    ),
  ],
  args: { onClose: fn() },
};

export default meta;

type Story = StoryObj<typeof CreateSavedSearchModal>;

// The from-scratch creation path on the Saved Searches page: empty name /
// description / query / entity types plus the shared filters editor.
export const Empty: Story = {};
