import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { makeFragmentData } from '@/graphql';

import { SearchGrid } from '../SearchGrid';

import { CommunicationCard, COMMUNICATION_FRAGMENT } from './CommunicationCard';

type StoryProps = ComponentProps<typeof CommunicationCard> & {
  subject: string;
  preview: string;
};

const meta: Meta<StoryProps> = {
  component: CommunicationCard,

  parameters: {
    layout: 'centered',
  },

  argTypes: {
    subject: {
      control: 'text',
    },

    preview: {
      control: 'text',
    },
  },
};

export default meta;

type Story = StoryObj<StoryProps>;

export const Default: Story = {
  args: {
    subject: 'Sample Subject',
    preview: 'Sample preview text for the communication.',
    onClick: fn(),
  },

  render: (args) => {
    const communication = {
      __typename: 'CommunicationType' as const,
      id: 'mock-id-1',
      subject: args.subject,
      preview: args.preview,
    };

    const maskedCommunication = makeFragmentData(communication, COMMUNICATION_FRAGMENT);

    return (
      <SearchGrid>
        <CommunicationCard communication={maskedCommunication} onClick={args.onClick} />
      </SearchGrid>
    );
  },
};
