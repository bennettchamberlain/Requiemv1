import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react';

import type { ScheduleCandidate } from '@/api/useScheduleCandidates';
import type { RhythmDay, ScheduleEvent } from '@/api/useScheduleService';
import { HorizonGrid } from '@/components/HorizonGrid';
import type { ColorMode } from '@/lib/activityPalette';

import { TaskSlate } from './TaskSlate';

const START = (() => {
  const d = new Date(2026, 7, 3);
  d.setHours(0, 0, 0, 0);

  return d;
})();

function at(dayOffset: number, hour: number): string {
  const d = new Date(START);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);

  return d.toISOString();
}

function ev(
  id: string,
  title: string,
  day: number,
  hour: number,
  hours: number,
  category: string | null,
  sourceSystem: string | null,
): ScheduleEvent {
  return {
    id,
    title,
    description: null,
    startTime: at(day, hour),
    endTime: at(day, hour + hours),
    isAllDay: false,
    status: 'confirmed',
    category,
    locationName: null,
    sourceSystem,
  };
}

/**
 * A week with real variety — several activity classes across several
 * connectors, which is what the two colour modes have to tell apart. A fixture
 * of all-WORK-from-one-calendar would make either mode look correct.
 */
const EVENTS: ScheduleEvent[] = [
  ev('e1', 'Backlog Grooming', 0, 14, 1, 'WORK', 'google_calendar'),
  ev('e2', 'Standup', 1, 9, 1, 'team_standup', 'google_calendar'),
  ev('e3', 'Morning run', 1, 7, 1, 'gym_workout', null),
  ev('e4', 'Dentist', 2, 11, 1, 'doctor_visit', 'outlook'),
  ev('e5', 'Engineering Strategy', 4, 16, 1, 'WORK', null),
  // Reproduces the real complaint: a title inherited from ci.actions that is a
  // bare category word, with what it actually is sitting in the description.
  {
    ...ev('e9', 'Action', 1, 11, 1, null, null),
    description: 'Send Liam the Q3 numbers before the review on Thursday',
  },
  ev('e6', 'Flight → SFO', 5, 18, 4, null, 'outlook'),
  ev('e7', 'Dinner with Liam', 5, 12, 2, null, null),
  ev('e8', 'Reading', 6, 20, 2, 'LEISURE', 'apple_calendar'),
];

/** Enough rhythm for the predicted lane to carry colour of its own. */
const RHYTHM: RhythmDay[] = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(START);
  d.setDate(d.getDate() + i);

  return {
    date: d.toISOString().slice(0, 10),
    dow: d.toLocaleDateString([], { weekday: 'long' }),
    clusters: [
      {
        clusterId: `work-${i}`,
        name: 'Deep work',
        l0Class: 'WORK',
        pOccur: 0.9,
        scheduled: false,
        daypartProbs: [
          { label: 'morning', probability: 0.5 },
          { label: 'afternoon', probability: 0.8 },
        ],
      },
      {
        clusterId: `sleep-${i}`,
        name: 'Asleep',
        l0Class: 'SLEEP',
        pOccur: 0.98,
        scheduled: false,
        daypartProbs: [{ label: 'night', probability: 0.95 }],
      },
      {
        clusterId: `leisure-${i}`,
        name: 'Winding down',
        l0Class: 'LEISURE',
        pOccur: 0.7,
        scheduled: false,
        daypartProbs: [{ label: 'evening', probability: 0.75 }],
      },
    ],
  };
});

function candidate(id: string, title: string, rationale: string, kind: string): ScheduleCandidate {
  return {
    id,
    title,
    description: rationale,
    rationale,
    rationaleSources: [{ kind, id: `${kind}-${id}`, note: null }],
    windowStart: START.toISOString(),
    windowEnd: at(6, 23),
    timeFlex: 'week',
    durationMinutes: 30,
    l0Class: null,
    fitScore: null,
    status: 'open',
    generator: `adapter/${kind}`,
    confidence: 0.7,
  };
}

const CANDIDATES: ScheduleCandidate[] = [
  candidate(
    'c1',
    'Review goals for Backlog Grooming',
    'Take a moment to review the core objectives of Backlog Grooming.',
    'action',
  ),
  candidate(
    'c2',
    'Pre-Read Prep',
    'Dedicate a minimum of 2 hours to outline the top 3 discussion points. (from "Optimize Meeting Cadence")',
    'insight',
  ),
  candidate(
    'c3',
    'The ‘Triple Threat’ Check-in',
    'Schedule a quick 15-minute virtual coffee chat with Liam and Max. (from "Strategic Networking")',
    'insight',
  ),
];

/** Live wiring, so the drop actually places a card during a manual drag. */
function Surface({ colorMode = 'type' }: { colorMode?: ColorMode }) {
  const [events, setEvents] = useState(EVENTS);
  const [slate, setSlate] = useState(CANDIDATES);

  return (
    <div className="flex flex-col gap-4">
      <TaskSlate
        candidates={slate}
        loading={false}
        onDecline={(id) => setSlate((rest) => rest.filter((c) => c.id !== id))}
        onSnooze={(id) => setSlate((rest) => rest.filter((c) => c.id !== id))}
        onReturnEvent={(eventId) => {
          const placed = events.find((e) => e.id === eventId);

          if (!placed) {
            return;
          }

          setEvents((rest) => rest.filter((e) => e.id !== eventId));
          setSlate((rest) => [
            {
              id: `returned-${eventId}`,
              title: placed.title,
              description: null,
              rationale: 'Taken back off the week.',
              rationaleSources: [{ kind: 'answer', id: eventId, note: null }],
              windowStart: START.toISOString(),
              windowEnd: at(6, 23),
              timeFlex: 'week',
              durationMinutes: 30,
              l0Class: placed.category,
              fitScore: null,
              status: 'open',
              generator: 'braindump/llm',
              confidence: 0.9,
            },
            ...rest,
          ]);
        }}
      />

      <HorizonGrid
        start={START}
        days={7}
        events={events}
        rhythm={RHYTHM}
        colorMode={colorMode}
        footer="Rhythm from your own patterns, updated Aug 4."
        onDropCandidate={(id, startTime) => {
          const placed = slate.find((c) => c.id === id);

          if (!placed) {
            return;
          }

          setSlate((rest) => rest.filter((c) => c.id !== id));
          setEvents((current) => [
            ...current,
            {
              id: `placed-${id}`,
              title: placed.title,
              description: placed.description ?? null,
              startTime: startTime.toISOString(),
              endTime: new Date(startTime.getTime() + 30 * 60_000).toISOString(),
              isAllDay: false,
              status: 'confirmed',
              category: null,
              locationName: null,
            },
          ]);
        }}
        onMoveEvent={(id, startTime) =>
          setEvents((current) =>
            current.map((e) => {
              if (e.id !== id) {
                return e;
              }

              const span = e.endTime ? new Date(e.endTime).getTime() - new Date(e.startTime).getTime() : 0;

              return {
                ...e,
                startTime: startTime.toISOString(),
                endTime: span ? new Date(startTime.getTime() + span).toISOString() : e.endTime,
                externalSyncStatus: e.sourceSystem ? 'pending' : e.externalSyncStatus,
              };
            }),
          )
        }
      />
    </div>
  );
}

const meta: Meta<typeof Surface> = {
  title: 'Schedule/Surface',
  component: Surface,
  parameters: { layout: 'padded' },
};

export default meta;

type Story = StoryObj<typeof Surface>;

/** Drag a card from Possibilities onto a day — it becomes committed time. */
export const WeekWithSlate: Story = {};

/** Hue as activity class — the reading both lanes share. */
export const ColouredByType: Story = { args: { colorMode: 'type' } };

/** Hue as provenance — which synced calendar owns each block. */
export const ColouredBySource: Story = { args: { colorMode: 'source' } };
