import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { gql } from '@/graphql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { EditEventModal } from './EditEventModal';

const UPDATE_PLAN_DAY_EVENT = gql(`
  mutation UpdatePlanDayEvent($input: UpdateEventInput!) {
    updateEvent(input: $input) {
      id
      title
      startTime
      endTime
      eventType
      taskId
      status
    }
  }
`);

const UPDATE_LINKED_TASK = gql(`
  mutation UpdatePlanDayEventTask($input: UpdateTaskInput!) {
    updateTask(input: $input) {
      success
      task {
        id
        title
        scheduledFor
        estimatedMinutes
      }
    }
  }
`);

const START = new Date(2026, 7, 18, 10, 0, 0, 0);
const END = new Date(2026, 7, 18, 10, 30, 0, 0);

const EVENT = {
  id: 'evt-1',
  title: 'Write the brief',
  startTime: START.toISOString(),
  endTime: END.toISOString(),
  taskId: null as string | null,
};

describe('EditEventModal', () => {
  it('opens with the current title and times', () => {
    renderWithProviders(<EditEventModal event={EVENT} onClose={vi.fn()} />, { mocks: [] });

    expect(screen.getByRole('dialog', { name: /edit calendar item/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^title$/i)).toHaveValue('Write the brief');
    expect(screen.getByLabelText(/^starts$/i)).toHaveValue('2026-08-18T10:00');
    expect(screen.getByLabelText(/^ends$/i)).toHaveValue('2026-08-18T10:30');
  });

  it('cancels without sending an update', () => {
    const onClose = vi.fn();
    renderWithProviders(<EditEventModal event={EVENT} onClose={onClose} />, { mocks: [] });

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves a new title', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();

    renderWithProviders(<EditEventModal event={EVENT} onClose={onClose} onSaved={onSaved} />, {
      mocks: [
        {
          request: {
            query: UPDATE_PLAN_DAY_EVENT,
            variables: {
              input: {
                id: EVENT.id,
                title: 'Write the brief notes',
                startTime: START.toISOString(),
                endTime: END.toISOString(),
              },
            },
          },
          result: {
            data: {
              updateEvent: {
                __typename: 'EventType',
                id: EVENT.id,
                title: 'Write the brief notes',
                startTime: START.toISOString(),
                endTime: END.toISOString(),
                eventType: 'calendar_event',
                taskId: null,
                status: 'confirmed',
              },
            },
          },
        },
      ],
    });

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Write the brief notes' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('updates the linked task when the calendar item is a planned block', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    const event = { ...EVENT, taskId: 'dGFzazoxMTE=' };

    renderWithProviders(<EditEventModal event={event} onClose={onClose} onSaved={onSaved} />, {
      mocks: [
        {
          request: {
            query: UPDATE_PLAN_DAY_EVENT,
            variables: {
              input: {
                id: event.id,
                title: 'Write the brief notes',
                startTime: START.toISOString(),
                endTime: END.toISOString(),
              },
            },
          },
          result: {
            data: {
              updateEvent: {
                __typename: 'EventType',
                id: event.id,
                title: 'Write the brief notes',
                startTime: START.toISOString(),
                endTime: END.toISOString(),
                eventType: 'planned_block',
                taskId: event.taskId,
                status: 'planned',
              },
            },
          },
        },
        {
          request: {
            query: UPDATE_LINKED_TASK,
            variables: {
              input: {
                id: event.taskId,
                title: 'Write the brief notes',
                scheduledFor: '2026-08-18',
                estimatedMinutes: 30,
              },
            },
          },
          result: {
            data: {
              updateTask: {
                __typename: 'UpdateTaskPayload',
                success: true,
                task: {
                  __typename: 'TaskType',
                  id: event.taskId,
                  title: 'Write the brief notes',
                  scheduledFor: '2026-08-18',
                  estimatedMinutes: 30,
                },
              },
            },
          },
        },
      ],
    });

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: 'Write the brief notes' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('refuses a blank title', () => {
    renderWithProviders(<EditEventModal event={EVENT} onClose={vi.fn()} />, { mocks: [] });

    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });
});
