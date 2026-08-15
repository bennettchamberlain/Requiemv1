import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ScheduleCandidate } from '@/api/useScheduleCandidates';
import { EVENT_DRAG_TYPE, EVENT_EXTERNAL_DRAG_TYPE } from '@/lib/scheduleDrag';

import { TaskSlate } from './TaskSlate';

vi.mock('@/hooks', () => ({
  useAuth: () => [{ authToken: 'test-token' }],
}));

vi.mock('@/common/feature', () => ({
  useFeatures: () => ({ isFeatureEnabled: () => false }),
}));

vi.mock('@/components/ChatWithAgent', () => ({
  ChatWithAgentMenu: () => null,
}));

function candidate(): ScheduleCandidate {
  return {
    id: 'c1',
    title: 'Book the dentist',
    description: null,
    rationale: 'You wrote this down.',
    rationaleSources: [{ kind: 'answer', id: 'a1', note: null }],
    windowStart: new Date(2026, 7, 3).toISOString(),
    windowEnd: new Date(2026, 7, 10).toISOString(),
    timeFlex: 'week',
    durationMinutes: 30,
    l0Class: null,
    fitScore: null,
    status: 'open',
    generator: 'braindump/llm',
    confidence: 0.9,
    personalization: null,
  };
}

/** jsdom has no DragEvent; hand-build one carrying our dataTransfer stub. */
function dropOn(node: HTMLElement, types: string[], data: Record<string, string> = {}) {
  const evt = createEvent.drop(node, {
    dataTransfer: {
      types,
      getData: (key: string) => data[key] ?? '',
      setData: () => {},
      dropEffect: '',
      effectAllowed: '',
    },
  });
  fireEvent(node, evt);

  return evt;
}

function panel(container: HTMLElement) {
  return container.querySelector('.rounded-xl') as HTMLElement;
}

const NOOP = { loading: false, onDecline: () => {}, onSnooze: () => {} };

describe('TaskSlate — refusing an event drop without corrupting the draft', () => {
  it('swallows the browser default on an externally-owned event', () => {
    // HorizonGrid stamps `text/plain` with the event title on every event drag,
    // and the brain-dump textarea inside this panel is a native drop target for
    // it. Returning early without preventDefault let the refusal path paste the
    // event's title into whatever the user was typing.
    const onReturnEvent = vi.fn();
    const { container } = render(
      <TaskSlate
        candidates={[candidate()]}
        {...NOOP}
        onBreakDown={async () => 0}
        onReturnEvent={onReturnEvent}
      />,
    );

    const evt = dropOn(panel(container), [EVENT_DRAG_TYPE, EVENT_EXTERNAL_DRAG_TYPE], {
      [EVENT_DRAG_TYPE]: JSON.stringify({ id: 'e9', grabOffsetMs: 0, externallyOwned: true }),
    });

    expect(evt.defaultPrevented).toBe(true);
    expect(onReturnEvent).not.toHaveBeenCalled();
  });

  it('swallows the browser default on an unreadable event payload', () => {
    const onReturnEvent = vi.fn();
    const { container } = render(
      <TaskSlate candidates={[candidate()]} {...NOOP} onReturnEvent={onReturnEvent} />,
    );

    const evt = dropOn(panel(container), [EVENT_DRAG_TYPE], { [EVENT_DRAG_TYPE]: 'not json' });

    expect(evt.defaultPrevented).toBe(true);
    expect(onReturnEvent).not.toHaveBeenCalled();
  });

  it('swallows the browser default even when returning is not wired up', () => {
    // No handler means the drop cannot be honoured — but it still must not fall
    // through to the textarea.
    const { container } = render(<TaskSlate candidates={[candidate()]} {...NOOP} />);

    const evt = dropOn(panel(container), [EVENT_DRAG_TYPE], {
      [EVENT_DRAG_TYPE]: JSON.stringify({ id: 'e9', grabOffsetMs: 0 }),
    });

    expect(evt.defaultPrevented).toBe(true);
  });

  it('leaves an ordinary text drop alone', () => {
    // Dragging a snippet of text into the compose box is a legitimate gesture
    // and none of this should touch it.
    const { container } = render(<TaskSlate candidates={[candidate()]} {...NOOP} onReturnEvent={() => {}} />);

    const evt = dropOn(panel(container), ['text/plain'], { 'text/plain': 'call Mum back' });

    expect(evt.defaultPrevented).toBe(false);
  });

  it('still honours a drop it can accept', () => {
    const onReturnEvent = vi.fn();
    const { container } = render(
      <TaskSlate candidates={[candidate()]} {...NOOP} onReturnEvent={onReturnEvent} />,
    );

    const evt = dropOn(panel(container), [EVENT_DRAG_TYPE], {
      [EVENT_DRAG_TYPE]: JSON.stringify({ id: 'e9', grabOffsetMs: 0 }),
    });

    expect(evt.defaultPrevented).toBe(true);
    expect(onReturnEvent).toHaveBeenCalledWith('e9');
  });
});

describe('TaskSlate — a failed load is not an empty slate', () => {
  it('says the suggestions could not be loaded rather than that there are none', () => {
    render(<TaskSlate candidates={[]} {...NOOP} error />);

    expect(screen.getByRole('alert')).toHaveTextContent(/Could not load your suggestions/);
    expect(screen.queryByText(/Nothing waiting yet/)).not.toBeInTheDocument();
  });

  it('keeps the empty-slate copy when nothing failed', () => {
    render(<TaskSlate candidates={[]} {...NOOP} />);

    expect(screen.getByText(/Nothing waiting yet/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the cards it has even if the last refresh failed', () => {
    render(<TaskSlate candidates={[candidate()]} {...NOOP} error />);

    expect(screen.getByText('Book the dentist')).toBeInTheDocument();
  });
});
