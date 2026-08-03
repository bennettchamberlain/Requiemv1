import { useState } from 'react';

import type { Meta, StoryObj } from '@storybook/react';

import type { ScheduleCandidate } from '@/api/useScheduleCandidates';
import type { ScheduleEvent } from '@/api/useScheduleService';
import { HorizonGrid } from '@/components/HorizonGrid';

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

const EVENTS: ScheduleEvent[] = [
  {
    id: 'e1',
    title: 'Backlog Grooming',
    startTime: at(0, 14),
    endTime: at(0, 15),
    isAllDay: false,
    status: 'confirmed',
    category: 'WORK',
    locationName: null,
    sourceSystem: 'google_calendar',
  },
  {
    id: 'e2',
    title: 'Engineering Strategy',
    startTime: at(4, 16),
    endTime: at(4, 17),
    isAllDay: false,
    status: 'confirmed',
    category: 'WORK',
    locationName: null,
    sourceSystem: null,
  },
];

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
function Surface() {
  const [events, setEvents] = useState(EVENTS);
  const [slate, setSlate] = useState(CANDIDATES);

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <div className="min-w-0 flex-1">
        <HorizonGrid
          start={START}
          days={7}
          events={events}
          rhythm={[]}
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

                const span = e.endTime
                  ? new Date(e.endTime).getTime() - new Date(e.startTime).getTime()
                  : 0;

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

      <TaskSlate
        candidates={slate}
        loading={false}
        onDecline={(id) => setSlate((rest) => rest.filter((c) => c.id !== id))}
        onSnooze={(id) => setSlate((rest) => rest.filter((c) => c.id !== id))}
        className="w-full xl:w-80 xl:shrink-0"
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

/** Drag a card from the slate onto a day — it becomes committed time. */
export const WeekWithSlate: Story = {};
