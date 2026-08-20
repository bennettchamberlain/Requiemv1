import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// The page body is irrelevant here — this spec is about what a bare
// `/memory/events` URL MEANS. Stub the data provider and the lazy views so
// rendering never reaches Apollo.
vi.mock('./useEntityService', () => ({
  EntityServiceProvider: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/ResponsiveLoader', () => ({
  ResponsiveLoader: () => <div data-testid="explorer-body" />,
}));

import { DEFAULT_MEMORY_EVENTS_SEARCH, MemoryPage } from './MemoryPage';

function LocationProbe() {
  const location = useLocation();

  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/memory/events"
          element={
            <>
              <MemoryPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MemoryPage default filters', () => {
  it('redirects a bare URL to the list view filtered to events', () => {
    renderAt('/memory/events');

    expect(screen.getByTestId('location')).toHaveTextContent(
      `/memory/events?${DEFAULT_MEMORY_EVENTS_SEARCH}`,
    );
    expect(screen.getByTestId('explorer-body')).toBeInTheDocument();
  });

  it('leaves a search deep link alone — the global search must search everything', () => {
    renderAt('/memory/events?search=sunset');

    expect(screen.getByTestId('location')).toHaveTextContent('/memory/events?search=sunset');
  });

  it('leaves a tag deep link alone', () => {
    renderAt('/memory/events?tags=travel');

    expect(screen.getByTestId('location')).toHaveTextContent('/memory/events?tags=travel');
  });

  it('leaves an explicit view choice alone (the /memory/knowledge redirect)', () => {
    renderAt('/memory/events?view=graph');

    expect(screen.getByTestId('location')).toHaveTextContent('/memory/events?view=graph');
  });
});
