import { render, screen , fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { EntityItem } from '../useEntityService';

import { StoryTimelineView } from './StoryTimelineView';

const entity = (shape: Record<string, unknown>) => shape as unknown as EntityItem;

function eventAt(id: string, start: Date, title = id): EntityItem {
  return entity({
    __typename: 'EventType',
    id,
    bucketStartTime: start.toISOString(),
    bucketTimeSource: 'source',
    title,
    startTime: start.toISOString(),
    locationName: null,
    description: null,
    mediaContentType: null,
  });
}

const setActiveEntityMock = vi.fn();
const useEntityServiceMock = vi.fn();

vi.mock('../useEntityService', async () => {
  const actual = await vi.importActual<typeof import('../useEntityService')>('../useEntityService');

  return {
    ...actual,
    useEntityService: () => useEntityServiceMock(),
  };
});

vi.mock('@/components/TimelineJs', () => ({
  TimelineJsHost: ({
    data,
    onSlideChange,
  }: {
    data: { events: Array<{ unique_id: string; text: { headline: string } }> };
    onSlideChange?: (uniqueId: string) => void;
  }) => (
    <div>
      {data.events.map((slide) => (
        <button key={slide.unique_id} onClick={() => onSlideChange?.(slide.unique_id)}>
          {slide.text.headline}
        </button>
      ))}
    </div>
  ),
}));

function baseService(overrides: Partial<ReturnType<typeof useEntityServiceMock>[0]> = {}) {
  return [
    {
      data: [],
      loading: false,
      loadingMore: false,
      hasNextPage: false,
      totalCount: 0,
      error: undefined,
      loadMore: vi.fn(),
      refetch: vi.fn(),
      ...overrides,
    },
    { setActiveEntity: setActiveEntityMock },
  ];
}

function renderTimeline(url = '/memory/events?view=timeline') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <StoryTimelineView />
    </MemoryRouter>,
  );
}

describe('StoryTimelineView', () => {
  it('sets the active entity to the clicked slide, so it opens the shared detail drawer', () => {
    const drill = eventAt('drill', new Date(2026, 6, 1, 10), 'Drill run');
    const lamp = eventAt('lamp', new Date(2026, 6, 2, 10), 'Desk lamp');
    useEntityServiceMock.mockReturnValue(baseService({ data: [drill, lamp] }));

    renderTimeline();

    fireEvent.click(screen.getByText('Desk lamp'));

    expect(setActiveEntityMock).toHaveBeenCalledWith(lamp);
  });

  it('shows how many dated slides are loaded, not just the ones that fit the window', () => {
    const flood = Array.from({ length: 80 }, (_, index) =>
      eventAt(`e-${index}`, new Date(2026, 5, 1 + index, 10), `Item ${index}`),
    );
    useEntityServiceMock.mockReturnValue(baseService({ data: flood }));

    renderTimeline();

    // 80 dated rows are in hand but the deck only ever mounts a window of
    // MEMORY_TIMELINE_MAX_SLIDES (48) — the count must say so, not go silent.
    expect(screen.getByText('48 of 80 loaded · end')).toBeInTheDocument();
  });
});
