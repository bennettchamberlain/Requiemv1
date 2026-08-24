import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScheduleEvent } from '@/api/useScheduleService';
import { renderWithProviders } from '@/test/renderWithProviders';

import { SchedulePage } from './SchedulePage';

const h = vi.hoisted(() => ({
  schedule: {} as Record<string, unknown>,
  plan: {} as Record<string, unknown>,
  reschedule: vi.fn(),
}));

vi.mock('@/api/useScheduleService', () => ({
  useScheduleService: () => h.schedule,
}));

vi.mock('@/pages/PlanPage/usePlanTasks', () => ({
  usePlanTasks: () => h.plan,
}));

vi.mock('@/api/useRescheduleEvent', () => ({
  useRescheduleEvent: () => h.reschedule,
}));

/**
 * Stand-in for the grid.
 *
 * The page's job here is wiring — which footer copy it chooses, and what it
 * does with a rejected drop — and driving those through real HTML5 drag events
 * would test HorizonGrid instead. The stub exposes the two callbacks as
 * buttons and renders the footer verbatim.
 */
vi.mock('@/components/HorizonGrid', () => ({
  HorizonGrid: ({
    footer,
    onDropCandidate,
    onMoveEvent,
  }: {
    footer?: string;
    onDropCandidate: (id: string, at: Date) => void;
    onMoveEvent: (id: string, at: Date) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onDropCandidate('c1', new Date())}>
        stub-drop
      </button>
      <button type="button" onClick={() => onMoveEvent('e1', new Date())}>
        stub-move
      </button>
      <p>{footer}</p>
    </div>
  ),
  // SchedulePage mounts this above the week chrome; keep it findable so the
  // page test can assert document order against the week heading.
  TodayStoryTimeline: () => <div>today-story</div>,
  VerticalCalendar: ({
    footer,
    onDropCandidate,
    onMoveEvent,
  }: {
    footer?: string;
    onDropCandidate: (id: string, at: Date) => void;
    onMoveEvent: (id: string, at: Date) => void;
  }) => (
    <div data-testid="vertical-calendar">
      <button type="button" onClick={() => onDropCandidate('c1', new Date())}>
        stub-drop
      </button>
      <button type="button" onClick={() => onMoveEvent('e1', new Date())}>
        stub-move
      </button>
      <p>{footer}</p>
    </div>
  ),
}));

vi.mock('@/components/TaskSlate', () => ({
  TaskSlate: ({
    sections,
    onDismissProposed,
    error,
  }: {
    sections: { key: string; tasks: { id: string; title: string }[] }[];
    onDismissProposed: (id: string) => void;
    error?: boolean;
  }) => (
    <>
      {error && <p>Could not load your plan. Try again shortly.</p>}
      {sections.flatMap((section) =>
        section.tasks.map((task) => (
          <button
            key={task.id}
            type="button"
            aria-label={`Dismiss ${task.title}`}
            onClick={() => onDismissProposed(task.id)}
          />
        )),
      )}
    </>
  ),
}));

const event = (overrides: Partial<ScheduleEvent> = {}): ScheduleEvent => ({
  id: 'e1',
  title: 'Standup',
  description: null,
  startTime: new Date(2026, 7, 3, 9).toISOString(),
  endTime: new Date(2026, 7, 3, 9, 30).toISOString(),
  isAllDay: false,
  status: 'confirmed',
  category: null,
  locationName: null,
  sourceSystem: null,
  externalSyncStatus: null,
  ...overrides,
});

function setSchedule(over: Record<string, unknown> = {}) {
  h.schedule = {
    events: [event()],
    rhythm: [],
    generatedAt: null,
    rhythmCoversWindow: false,
    loading: false,
    fetching: false,
    error: false,
    refetch: vi.fn(),
    ...over,
  };
}

function setPlan(over: Record<string, unknown> = {}) {
  h.plan = {
    backlog: [],
    backlogCount: 0,
    loading: false,
    error: false,
    placeOnDay: vi.fn().mockResolvedValue(undefined),
    dismissProposed: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

beforeEach(() => {
  setSchedule();
  setPlan();
  h.reschedule = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => vi.clearAllMocks());

describe('SchedulePage — what the footer is allowed to claim', () => {
  it('says the rhythm is live only when it covers the window on screen', () => {
    setSchedule({
      generatedAt: '2026-08-05T03:00:00.000Z',
      rhythm: [{ date: '2026-08-05', dow: 'Wed', clusters: [] }],
      rhythmCoversWindow: true,
    });

    renderWithProviders(<SchedulePage />);

    expect(screen.getByText(/Pattern rhythm \(HBPE\) from your history, updated/)).toBeInTheDocument();
  });

  it('does not claim freshness for a week the forecast horizon cannot reach', () => {
    // The regression: the forecast resolved (so `generatedAt` was set) but for
    // the wrong seven days, and the footer went on saying "updated <date>" over
    // an empty lane — which reads as "the model knows nothing about you".
    setSchedule({ generatedAt: '2026-08-05T03:00:00.000Z', rhythm: [], rhythmCoversWindow: false });

    renderWithProviders(<SchedulePage />);

    expect(screen.queryByText(/Pattern rhythm \(HBPE\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/only covers the next seven days/)).toBeInTheDocument();
  });

  it('says the layer is unavailable when the forecast resolver returned nothing', () => {
    setSchedule({ generatedAt: null, rhythm: [], rhythmCoversWindow: false });

    renderWithProviders(<SchedulePage />);

    expect(screen.getByText(/HBPE rhythm forecast is off/)).toBeInTheDocument();
  });
});

describe('SchedulePage — mutations that the server refuses', () => {
  it('tells the user when a placement is rejected', async () => {
    setPlan({ placeOnDay: vi.fn().mockRejectedValue(new Error('slot taken')) });

    renderWithProviders(<SchedulePage />);
    fireEvent.click(screen.getByText('stub-drop'));

    expect(await screen.findByText(/Could not put that on the calendar/)).toBeInTheDocument();
  });

  it('tells the user when a move is rejected', async () => {
    h.reschedule = vi.fn().mockRejectedValue(new Error('read only calendar'));

    renderWithProviders(<SchedulePage />);
    fireEvent.click(screen.getByText('stub-move'));

    expect(await screen.findByText(/Could not move that/)).toBeInTheDocument();
  });

  it('tells the user when dismissing a proposed task is rejected', async () => {
    setPlan({
      backlog: [{ key: 'proposed', tasks: [{ id: 't1', title: 'Book the dentist' }] }],
      backlogCount: 1,
      dismissProposed: vi.fn().mockRejectedValue(new Error('gone')),
    });

    renderWithProviders(<SchedulePage />);
    fireEvent.click(screen.getByLabelText('Dismiss Book the dentist'));

    expect(await screen.findByText(/Could not dismiss that task/)).toBeInTheDocument();
  });

  it('clears the message when the next attempt succeeds', async () => {
    setPlan({ placeOnDay: vi.fn().mockRejectedValue(new Error('slot taken')) });

    renderWithProviders(<SchedulePage />);
    fireEvent.click(screen.getByText('stub-drop'));
    expect(await screen.findByText(/Could not put that on the calendar/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('stub-move'));

    await waitFor(() =>
      expect(screen.queryByText(/Could not put that on the calendar/)).not.toBeInTheDocument(),
    );
  });
});

describe('SchedulePage — failed queries', () => {
  it('keeps the events that resolved when one field errored', () => {
    setSchedule({ error: true, events: [event({ title: 'Standup' })] });

    renderWithProviders(<SchedulePage />);

    expect(screen.getByText(/what is shown may be incomplete/)).toBeInTheDocument();
    // The grid is still on screen rather than replaced wholesale.
    expect(screen.getByText('stub-drop')).toBeInTheDocument();
  });

  it('falls back to the hard error when nothing resolved', () => {
    setSchedule({ error: true, events: [] });

    renderWithProviders(<SchedulePage />);

    expect(screen.getByText(/Could not load the schedule/)).toBeInTheDocument();
    expect(screen.queryByText('stub-drop')).not.toBeInTheDocument();
  });

  it('shows the slate as failed rather than empty when the plan list errors', () => {
    setSchedule({ events: [], rhythm: [] });
    setPlan({ error: true });

    renderWithProviders(<SchedulePage />);

    expect(screen.getByText(/Could not load your plan/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing in Proposed or Unscheduled/)).not.toBeInTheDocument();
    // Not the "connect a calendar" empty state either — nothing is known to be
    // empty when the request that would have said so failed.
    expect(screen.queryByText(/Connect a calendar/)).not.toBeInTheDocument();
  });

  it('still shows the empty state when everything resolved and there is nothing', () => {
    setSchedule({ events: [], rhythm: [] });

    renderWithProviders(<SchedulePage />);

    expect(screen.getByText(/Connect a calendar/)).toBeInTheDocument();
  });

  it('keeps the week visible when the calendar is empty but Plan has backlog', () => {
    setSchedule({ events: [], rhythm: [] });
    setPlan({
      backlog: [{ key: 'unscheduled', tasks: [{ id: 't1', title: 'Call the dentist' }] }],
      backlogCount: 1,
    });

    renderWithProviders(<SchedulePage />);

    expect(screen.getByTestId('vertical-calendar')).toBeInTheDocument();
    expect(screen.queryByText(/Connect a calendar/)).not.toBeInTheDocument();
  });
});

describe('SchedulePage — week paging', () => {
  it('shows the date range between the arrows and updates it when paging', () => {
    setSchedule({ events: [], rhythm: [] });

    renderWithProviders(<SchedulePage />);

    const heading = () => screen.getByRole('heading', { level: 2 });
    const initial = heading().textContent;

    fireEvent.click(screen.getByLabelText('Next week'));
    expect(heading().textContent).not.toBe(initial);
    expect(screen.queryByText('Today')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to today' }));
    expect(heading().textContent).toBe(initial);
  });

  it('keeps the grid visible on a later week even when that week is empty', () => {
    setSchedule({ events: [], rhythm: [] });

    renderWithProviders(<SchedulePage />);
    fireEvent.click(screen.getByLabelText('Next week'));

    expect(screen.getByText('stub-drop')).toBeInTheDocument();
    expect(screen.queryByText(/Connect a calendar/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing on the calendar this week/)).not.toBeInTheDocument();
  });

  it('sits the week chrome above the calendar grid', () => {
    renderWithProviders(<SchedulePage />);

    const heading = screen.getByRole('heading', { level: 2 });
    const grid = screen.getByTestId('vertical-calendar');

    expect(heading.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('today-story')).not.toBeInTheDocument();
  });

  it('puts the today story above the week chrome on the horizon view', () => {
    renderWithProviders(<SchedulePage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Horizon' }));

    const story = screen.getByText('today-story');
    const heading = screen.getByRole('heading', { level: 2 });
    const grid = screen.getByText('stub-drop');

    expect(story.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heading.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe('phone layout', () => {
    function setViewport(mobile: boolean) {
      window.matchMedia = ((query: string) => ({
        matches: query.includes('max-width') ? mobile : query.includes('landscape') ? !mobile : false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
    }

    afterEach(() => setViewport(false));

    it('replaces the story strip with now and next on the Horizon tab, and keeps a tappable week', async () => {
      setViewport(true);

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(startOfToday);
      endOfToday.setHours(23, 59, 0, 0);

      setSchedule({
        events: [
          event({
            title: 'Afternoon review',
            isAllDay: true,
            startTime: startOfToday.toISOString(),
            endTime: endOfToday.toISOString(),
          }),
        ],
      });

      renderWithProviders(<SchedulePage />);

      await waitFor(() => expect(screen.queryByText('today-story')).not.toBeInTheDocument());
      fireEvent.click(screen.getByRole('tab', { name: 'Horizon' }));

      expect(screen.getByText('Afternoon review')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Show week' })).toBeInTheDocument();
      expect(
        screen.getByRole('tablist', { name: 'Days this week' }).querySelectorAll('[role="tab"]'),
      ).toHaveLength(7);
      expect(screen.getByText('stub-drop')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Show week' }));
      expect(screen.getByRole('button', { name: 'Hide week' })).toBeInTheDocument();
      expect(screen.queryByRole('tablist', { name: 'Days this week' })).not.toBeInTheDocument();
    });

    it('keeps day chips on the Calendar tab and hides the horizon week toggle', async () => {
      setViewport(true);

      renderWithProviders(<SchedulePage />);

      await waitFor(() => expect(screen.queryByText('today-story')).not.toBeInTheDocument());

      expect(screen.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByTestId('vertical-calendar')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Show week' })).not.toBeInTheDocument();
      expect(
        screen.getByRole('tablist', { name: 'Days this week' }).querySelectorAll('[role="tab"]'),
      ).toHaveLength(7);
    });
  });

  /**
   * Embedded in Today, this page contributes content and no chrome.
   *
   * The positioning assertion is the one that would fail silently in the
   * browser rather than in CI: LoadingPage is `absolute inset-0 z-10`, so an
   * unpositioned wrapper sends it to the host's PageContent, and the schedule's
   * spinner covers the brief stacked below it.
   */
  describe('embedded', () => {
    it('leaves the document title to the host', () => {
      document.title = 'set by the host';

      renderWithProviders(<SchedulePage embedded />);
      expect(document.title).toBe('set by the host');

      cleanup();

      renderWithProviders(<SchedulePage />);
      expect(document.title).toContain('Schedule');
    });

    it('anchors its own overlays instead of the host page', () => {
      setSchedule({ fetching: true, events: [], rhythm: [] });

      const { container } = renderWithProviders(<SchedulePage embedded />);
      const surface = container.querySelector('.min-h-60');

      expect(surface).not.toBeNull();
      expect(surface).toHaveClass('relative');
    });

    it('still renders the week itself', () => {
      renderWithProviders(<SchedulePage embedded />);

      expect(screen.getByText('stub-drop')).toBeInTheDocument();
    });
  });
});

describe('SchedulePage — layout tabs', () => {
  it('starts on the calendar view', () => {
    renderWithProviders(<SchedulePage />);

    const tabs = screen.getByRole('tablist', { name: 'Schedule layout' }).querySelectorAll('[role="tab"]');
    expect([...tabs].map((tab) => tab.textContent)).toEqual(['Calendar', 'Horizon']);
    expect(screen.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('vertical-calendar')).toBeInTheDocument();
    expect(screen.queryByText('today-story')).not.toBeInTheDocument();
  });

  it('switches to the horizon view and back', () => {
    renderWithProviders(<SchedulePage />);

    fireEvent.click(screen.getByRole('tab', { name: 'Horizon' }));

    expect(screen.getByRole('tab', { name: 'Horizon' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('today-story')).toBeInTheDocument();
    expect(screen.queryByTestId('vertical-calendar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Calendar' }));

    expect(screen.getByTestId('vertical-calendar')).toBeInTheDocument();
    expect(screen.queryByText('today-story')).not.toBeInTheDocument();
  });
});
