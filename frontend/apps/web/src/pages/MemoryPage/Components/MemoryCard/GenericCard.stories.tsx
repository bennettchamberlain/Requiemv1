import type { ComponentProps } from 'react';

import { User, FileText, Lightbulb, Package } from '@ci/shadcn/icons';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { GenericCard } from './GenericCard';

type Props = ComponentProps<typeof GenericCard>;

const meta: Meta<Props> = {
  component: GenericCard,
  parameters: {
    layout: 'centered',
  },
  args: {
    title: 'Example Memory Card',
    subtitle: 'Category',
    description: 'This is a description of the memory card that provides additional context.',
    preview: (
      <div className="flex flex-wrap gap-2">
        <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">Tag 1</span>
        <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">Tag 2</span>
        <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">Tag 3</span>
      </div>
    ),
    icon: User,
    onClick: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<Props>;

export const Default: Story = {
  args: {},
};

export const WithUserIcon: Story = {
  args: {
    title: 'John Doe',
    subtitle: 'Person',
    description: 'A contact person in your network.',
    icon: User,
  },
};

export const WithFileIcon: Story = {
  args: {
    title: 'Project Proposal.pdf',
    subtitle: 'Document',
    description: 'A document containing project details and requirements.',
    icon: FileText,
  },
};

export const WithLightbulbIcon: Story = {
  args: {
    title: 'Machine Learning Concept',
    subtitle: 'Concept',
    description: 'An idea or concept related to machine learning algorithms.',
    icon: Lightbulb,
  },
};

export const WithPackageIcon: Story = {
  args: {
    title: 'Laptop',
    subtitle: 'Thing',
    description: 'A physical object or item.',
    icon: Package,
  },
};

export const NoSubtitle: Story = {
  args: {
    subtitle: undefined,
  },
};

export const NoDescription: Story = {
  args: {
    description: undefined,
  },
};

export const NoPreview: Story = {
  args: {
    preview: null,
  },
};

export const Minimal: Story = {
  args: {
    subtitle: undefined,
    description: undefined,
    preview: null,
  },
};

export const LongTitle: Story = {
  args: {
    title: 'This is a very long title that should truncate when it exceeds the available space in the card',
  },
};

export const LongDescription: Story = {
  args: {
    description:
      'This is a very long description that provides extensive details about the memory card. It contains multiple sentences and should wrap properly within the card layout. The description can be quite lengthy and should still look good.',
  },
};

export const ManyTags: Story = {
  args: {
    preview: (
      <div className="flex flex-wrap gap-2">
        <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">Tag 1</span>
        <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">Tag 2</span>
        <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">Tag 3</span>
        <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">Tag 4</span>
        <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">Tag 5</span>
        <span className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">Tag 6</span>
      </div>
    ),
  },
};
