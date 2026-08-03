import type { ComponentProps } from 'react';

import type { Meta, StoryObj } from '@storybook/react';

import type { RhythmDay, ScheduleEvent } from '@/api/useScheduleService';

import { HorizonGrid } from './HorizonGrid';

type Props = ComponentProps<typeof HorizonGrid>;

/** Monday of the sample week, local midnight. */
const START = (() => {
  const d = new Date(2026, 7, 3);
  d.setHours(0, 0, 0, 0);

  return d;
})();

function at(dayOffset: number, hour: number, minute = 0): string {
  const d = new Date(START);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);

  return d.toISOString();
}

function event(
  id: string,
  title: string,
  dayOffset: number,
  startHour: number,
  endHour: number,
  overrides: Partial<ScheduleEvent> = {},
): ScheduleEvent {
  return {
    id,
    title,
    startTime: at(dayOffset, startHour),
    endTime: at(dayOffset, endHour),
    isAllDay: false,
    status: 'confirmed',
    category: 'WORK',
    locationName: null,
    ...overrides,
  };
}

// A working week: daily standup, a couple of real meetings, a red-eye that
// crosses midnight, and a quiet weekend.
const EVENTS: ScheduleEvent[] = [
  event('e1', 'Standup', 0, 9, 9.5),
  event('e2', 'Design review', 0, 14, 15),
  event('e3', 'Standup', 1, 9, 9.5),
  event('e4', 'Lunch — Ana', 1, 12, 13, { category: 'SOCIAL', locationName: 'Cafe Mono' }),
  event('e5', 'Standup', 2, 9, 9.5),
  event('e6', 'Flight → SFO', 2, 22, 24, { category: 'TRANSIT', locationName: 'SFO' }),
  event('e7', 'Standup', 3, 9, 9.5),
  event('e8', 'Offsite', 3, 10, 17, { status: 'tentative' }),
  event('e9', 'Standup', 4, 9, 9.5),
  event('e10', 'Deep work', 4, 13, 17),
];

function cluster(
  clusterId: string,
  name: string,
  l0Class: string,
  pOccur: number,
  dayparts: [string, number][],
) {
  return {
    clusterId,
    name,
    l0Class,
    pOccur,
    scheduled: false,
    daypartProbs: dayparts.map(([label, probability]) => ({ label, probability })),
  };
}

const DATES = [
  '2026-08-03',
  '2026-08-04',
  '2026-08-05',
  '2026-08-06',
  '2026-08-07',
  '2026-08-08',
  '2026-08-09',
];

const RHYTHM: RhythmDay[] = DATES.map((date, i) => {
  const weekday = i < 5;

  return {
    date,
    dow: new Date(`${date}T00:00:00Z`).toLocaleDateString([], { weekday: 'long', timeZone: 'UTC' }),
    clusters: [
      ...(weekday
        ? [
            cluster('c-work', 'Focused work block', 'WORK', 0.92, [
              ['morning', 0.55],
              ['afternoon', 0.8],
            ]),
          ]
        : []),
      cluster('c-gym', 'Strength session', 'EXERCISE', weekday ? 0.35 : 0.62, [['evening', 0.7]]),
      cluster('c-read', 'Evening reading', 'LEISURE', 0.48, [['evening', 0.55]]),
      ...(weekday ? [] : [cluster('c-errand', 'Weekend errands', 'ERRAND', 0.55, [['morning', 0.65]])]),
    ],
  };
});

const meta: Meta<Props> = {
  title: 'Schedule/HorizonGrid',
  component: HorizonGrid,
  parameters: { layout: 'padded' },
};

export default meta;

type Story = StoryObj<Props>;

/** Committed time over the predicted rhythm — the full P0 surface. */
export const Week: Story = {
  args: { start: START, days: 7, events: EVENTS, rhythm: RHYTHM },
};

/** Rhythm layer unavailable (hbpe flag off, or engine cold). Still true, still useful. */
export const CommittedOnly: Story = {
  args: { start: START, days: 7, events: EVENTS, rhythm: [] },
};

/** A new install: nothing connected yet. */
export const Empty: Story = {
  args: { start: START, days: 7, events: [], rhythm: [] },
};

/** Rhythm with no bookings — what the week usually holds, before anything is planned. */
export const RhythmOnly: Story = {
  args: { start: START, days: 7, events: [], rhythm: RHYTHM },
};

/** Two weeks, to check the geometry holds as the horizon lengthens. */
export const Fortnight: Story = {
  args: { start: START, days: 14, events: EVENTS, rhythm: RHYTHM },
};
