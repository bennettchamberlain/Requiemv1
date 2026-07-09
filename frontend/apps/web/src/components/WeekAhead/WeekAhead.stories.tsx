import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';

import type { DueForecast, WeekForecast } from '@/api/useWeekAheadService';

import { WeekAhead } from './WeekAhead';

type Props = ComponentProps<typeof WeekAhead>;

// Realistic sample: a weekly-rhythm user with a handful of discovered clusters.
// Dates are arbitrary; the component derives weekday labels from them.
const DAY_DATES = ['2026-07-10', '2026-07-11', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16'];

function cluster(clusterId: string, name: string, l0Class: string, pOccur: number, dayparts: [string, number][]) {
  return {
    clusterId,
    name,
    l0Class,
    pOccur,
    daypartProbs: dayparts.map(([label, probability]) => ({ label, probability })),
  };
}

const week: WeekForecast = {
  horizon: '7d',
  generatedAt: '2026-07-09T09:41:00Z',
  days: DAY_DATES.map((date, i) => ({
    date,
    dow: new Date(`${date}T00:00:00Z`).toLocaleDateString([], { weekday: 'long', timeZone: 'UTC' }),
    clusters: [
      cluster('c-focus', 'Deep Focus', 'WORK', [0.85, 0.12, 0.1, 0.9, 0.88, 0.9, 0.82][i], [['morning', 0.7]]),
      cluster('c-gym', 'Gym Session', 'EXERCISE', [0.15, 0.55, 0.12, 0.08, 0.78, 0.1, 0.72][i], [['evening', 0.8]]),
      cluster('c-groceries', 'Groceries', 'ERRAND', [0.2, 0.74, 0.3, 0.08, 0.06, 0.1, 0.14][i], [['afternoon', 0.6]]),
      cluster('c-friends', 'See Friends', 'SOCIAL', [0.35, 0.62, 0.4, 0.1, 0.08, 0.12, 0.15][i], [['evening', 0.9]]),
      cluster('c-family', 'Family Call', 'SOCIAL', [0.1, 0.18, 0.7, 0.12, 0.06, 0.08, 0.1][i], [['evening', 0.55]]),
    ].filter((c) => c.pOccur >= 0.05),
  })),
};

const due: DueForecast = {
  generatedAt: '2026-07-09T09:41:00Z',
  due: [
    {
      clusterId: 'c-friends',
      name: 'See Friends',
      l0Class: 'SOCIAL',
      lastSeen: '2026-06-23',
      daysSinceLast: 16,
      medianIntervalDays: 7,
      dueInDays: -9,
      window: [-9, -7],
      overdue: true,
      confidence: 0.72,
    },
    {
      clusterId: 'c-family',
      name: 'Family Call',
      l0Class: 'SOCIAL',
      lastSeen: '2026-06-27',
      daysSinceLast: 12,
      medianIntervalDays: 14,
      dueInDays: 2,
      window: [1, 4],
      overdue: false,
      confidence: 0.81,
    },
    {
      clusterId: 'c-haircut',
      name: 'Haircut',
      l0Class: 'ERRAND',
      lastSeen: '2026-06-10',
      daysSinceLast: 29,
      medianIntervalDays: 35,
      dueInDays: 6,
      window: [3, 9],
      overdue: false,
      confidence: 0.66,
    },
  ],
};

const meta: Meta<Props> = {
  component: WeekAhead,
  parameters: {
    layout: 'padded',
  },
  args: { week, due },
};

export default meta;

type Story = StoryObj<Props>;

export const Default: Story = {};

export const NoDueItems: Story = {
  args: { week, due: { generatedAt: week.generatedAt, due: [] } },
};

export const EmptyRendersNothing: Story = {
  args: {
    week: { horizon: '7d', generatedAt: week.generatedAt, days: DAY_DATES.map((date) => ({ date, dow: '', clusters: [] })) },
    due: null,
  },
};
