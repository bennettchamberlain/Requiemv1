import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';

import type { ScheduleCandidate } from '@/api/useScheduleCandidates';

import { TaskSlate } from './TaskSlate';

type Props = ComponentProps<typeof TaskSlate>;

function candidate(
  id: string,
  title: string,
  rationale: string,
  kind: string,
  overrides: Partial<ScheduleCandidate> = {},
): ScheduleCandidate {
  return {
    id,
    title,
    description: rationale,
    rationale,
    rationaleSources: [{ kind, id: `${kind}-${id}`, note: null }],
    windowStart: new Date(2026, 7, 3).toISOString(),
    windowEnd: new Date(2026, 7, 10).toISOString(),
    timeFlex: 'week',
    durationMinutes: 30,
    l0Class: null,
    fitScore: null,
    status: 'open',
    generator: `adapter/${kind}`,
    confidence: 0.7,
    ...overrides,
  };
}

// Drawn from the live account, so the copy is the length it really is.
const CANDIDATES: ScheduleCandidate[] = [
  candidate(
    'c1',
    'Review goals for Backlog Grooming',
    'Take a moment to review the core objectives of Backlog Grooming.',
    'action',
    { confidence: 0.8 },
  ),
  candidate(
    'c2',
    'Pre-Read Prep',
    'Dedicate a minimum of 2 hours before July 31st to outline the top 3 discussion points you want to achieve for that meeting. (from "Optimize Meeting Cadence: Group Related Tasks")',
    'insight',
    { durationMinutes: 120 },
  ),
  candidate(
    'c3',
    'The ‘Triple Threat’ Check-in',
    'Since you share organizing duties with both Liam and Max, schedule a quick 15-minute virtual coffee chat with all three of them. (from "Strategic Networking Opportunity")',
    'insight',
    { durationMinutes: 15 },
  ),
  candidate('c4', 'Watch a movie', "Why don't you watch a movie tonight?", 'action', {
    confidence: 0.4,
  }),
  candidate(
    'c5',
    'Organize and structure your AI research notes',
    'Take a dedicated block of time to consolidate the AI/LLM material you have been collecting.',
    'action',
  ),
];

const meta: Meta<Props> = {
  title: 'Schedule/TaskSlate',
  component: TaskSlate,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div style={{ width: 340 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;

type Story = StoryObj<Props>;

export const Populated: Story = {
  args: { candidates: CANDIDATES, loading: false, onDecline: () => {}, onSnooze: () => {} },
};

/** Nothing waiting — should read as calm, not as a failure. */
export const Empty: Story = {
  args: { candidates: [], loading: false, onDecline: () => {}, onSnooze: () => {} },
};

export const Loading: Story = {
  args: { candidates: [], loading: true, onDecline: () => {}, onSnooze: () => {} },
};
