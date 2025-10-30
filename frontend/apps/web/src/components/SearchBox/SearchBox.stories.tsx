import type { ComponentProps } from 'react';

import { Input } from '@ci/shadcn';
import { User, FileText, MapPin, Calendar } from '@ci/shadcn/icons';
import type { Meta, StoryObj } from '@storybook/react';
import { fn } from 'storybook/test';

import { SearchBox } from './SearchBox';

type Props = ComponentProps<typeof SearchBox>;

const sampleResults = [
  {
    id: '1',
    content: (
      <div className="flex items-center gap-2 text-sm">
        <User className="h-4 w-4 text-blue-500" />
        <span className="font-medium">John Smith</span>
        <span className="text-muted-foreground">Contact</span>
      </div>
    ),
  },
  {
    id: '2',
    content: (
      <div className="flex items-center gap-2 text-sm">
        <FileText className="h-4 w-4 text-green-500" />
        <span className="font-medium">Meeting Notes.pdf</span>
        <span className="text-muted-foreground">Document</span>
      </div>
    ),
  },
  {
    id: '3',
    content: (
      <div className="flex items-center gap-2 text-sm">
        <MapPin className="h-4 w-4 text-red-500" />
        <span className="font-medium">Coffee Shop on Main St</span>
        <span className="text-muted-foreground">Place</span>
      </div>
    ),
  },
  {
    id: '4',
    content: (
      <div className="flex items-center gap-2 text-sm">
        <Calendar className="h-4 w-4 text-purple-500" />
        <span className="font-medium">Team Meeting</span>
        <span className="text-muted-foreground">Event</span>
        <span className="text-muted-foreground">(Tomorrow 2:00 PM)</span>
      </div>
    ),
  },
  {
    id: '5',
    content: (
      <div className="flex items-center gap-2 text-sm">
        <FileText className="h-4 w-4 text-orange-500" />
        <span className="font-medium">Project Proposal.docx</span>
        <span className="text-muted-foreground">Document</span>
      </div>
    ),
  },
  {
    id: '6',
    content: (
      <div className="flex items-center gap-2 text-sm">
        <User className="h-4 w-4 text-blue-500" />
        <span className="font-medium">Sarah Johnson</span>
        <span className="text-muted-foreground">Contact</span>
      </div>
    ),
  },
];

const meta: Meta<Props> = {
  component: SearchBox,
  parameters: {
    layout: 'centered',
  },
  args: {
    onSearch: fn(),
    onResultSelect: fn(),
  },
  decorators: [(Story) => <Story />],
};

export default meta;

type Story = StoryObj<Props>;

export const Default: Story = {};

export const Loading: Story = {
  args: {
    loading: true,
  },
};

export const Disabled: Story = {
  args: {
    disabled: true,
  },
  decorators: [
    (Story) => (
      <div className="flex flex-row items-center gap-4">
        <Input placeholder="Enter text here..." disabled />
        <Story />
      </div>
    ),
  ],
};

export const NextToShadCNInput: Story = {
  decorators: [
    (Story) => (
      <div className="flex flex-row items-center gap-4">
        <Input placeholder="Enter text here..." />
        <Story />
      </div>
    ),
  ],
};

export const SingleResult: Story = {
  args: {
    results: [sampleResults[0]],
  },
  decorators: [
    (Story) => (
      <div className="flex flex-col items-center">
        <Story />
        <p className="text-xs text-muted-foreground mt-4">Type in search box to see results appear</p>
      </div>
    ),
  ],
};

export const ManyResults: Story = {
  args: {
    results: sampleResults,
  },
  decorators: [
    (Story) => (
      <div className="flex flex-col items-center">
        <Story />
        <p className="text-xs text-muted-foreground mt-4">Type in search box to see results appear</p>
      </div>
    ),
  ],
};
