/**
 * The header/global search box: the single free-text entry point that also
 * drives the Memory Explorer's `?search=` URL state (the exact param this
 * session found the backend fabricating a `totalCount` for). This suite
 * exercises what actually lands in the URL/route when a person types,
 * submits, or clears — the part most likely to silently break in a refactor
 * — not the dropdown's visual contents (each result row has its own tests).
 */
import { GlobalUID } from '@ci/common';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { GlobalSearchBox } from './GlobalSearchBox';

const h = vi.hoisted(() => ({
  search: {
    data: [] as unknown[],
    tags: [] as { id: string; label: string }[],
    loading: false,
    error: undefined as unknown,
  },
}));

// GlobalSearchBox's own job is turning a typed/committed query and a selected
// suggestion into URL state and navigation — not fetching. Stubbing the
// network hook lets each test control exactly which suggestions/tags are on
// screen without reproducing the SEARCH_QUERY document or Apollo mocks.
vi.mock('./useSearchService', () => ({
  useSearchService: () => h.search,
}));

// Off `/memory`, the panel footer mounts the full advanced-filter surface
// (ExplorerToolbar's SearchPanelFilters), which reaches for useFeatures/
// useAuth/useMutation context this test doesn't provide. GlobalSearchBox only
// composes it in; assert that composition without dragging its internals in.
vi.mock('@/pages/MemoryPage/Components/ExplorerToolbar/ExplorerToolbar', () => ({
  SearchPanelFilters: () => <div>advanced filters</div>,
}));

function LocationProbe() {
  const location = useLocation();

  return (
    <>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="query">{location.search}</div>
    </>
  );
}

function renderAt(route: string) {
  return renderWithProviders(
    <>
      <GlobalSearchBox />
      <LocationProbe />
    </>,
    { route },
  );
}

/** Current route's query params, read off the LocationProbe — order-independent. */
function params(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId('query').textContent ?? '');
}

function path(): string {
  return screen.getByTestId('path').textContent ?? '';
}

/** Same gesture SearchBox itself requires before it will open on focus: a pointer engagement, then focus. */
function engage(input: HTMLElement) {
  fireEvent.pointerDown(input);
  fireEvent.focus(input);
}

beforeEach(() => {
  localStorage.clear();
  h.search = { data: [], tags: [], loading: false, error: undefined };
});

describe('GlobalSearchBox on /memory', () => {
  it('writes the typed query live into ?search= (debounced)', async () => {
    renderAt('/memory');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'latte' } });

    await waitFor(() => expect(params().get('search')).toBe('latte'));
    expect(path()).toBe('/memory');
  });

  it('removes ?search= once the input is cleared back to empty', async () => {
    renderAt('/memory?search=latte');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });

    await waitFor(() => expect(params().has('search')).toBe(false));
  });

  it('seeds the input from an existing ?search= param', () => {
    renderAt('/memory?search=vacation');

    expect(screen.getByRole('textbox')).toHaveValue('vacation');
  });

  it('Enter commits the trimmed text, empties the box, and remembers the query', () => {
    renderAt('/memory');

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'latte  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(params().get('search')).toBe('latte');
    // Commit remounts the box (a fresh, empty input, refocused for the next
    // search), so re-query rather than reuse the detached pre-commit node.
    expect(screen.getByRole('textbox')).toHaveValue('');

    // The trimmed (not raw) query is what gets remembered for next time.
    expect(JSON.parse(localStorage.getItem('memoryRecentSearches') ?? '[]')).toEqual(['latte']);
  });

  it('X clears both the query and the pinned explorer filters, staying on /memory', () => {
    renderAt('/memory?search=foo&tags=vacation&notAFilter=keep');

    fireEvent.click(screen.getByRole('button', { name: /clear search and filters/i }));

    expect(path()).toBe('/memory');
    expect(params().has('search')).toBe(false);
    expect(params().has('tags')).toBe(false);
    // Only `search` + the known FILTER_PARAMS are swept — not every param on the URL.
    expect(params().get('notAFilter')).toBe('keep');
  });

  it('"Clear search filters" removes only the pinned filters, leaving the query box alone', () => {
    renderAt('/memory?tags=vacation&notAFilter=keep');

    engage(screen.getByRole('textbox'));
    fireEvent.click(screen.getByText('Clear search filters'));

    expect(params().has('tags')).toBe(false);
    expect(params().get('notAFilter')).toBe('keep');
  });

  it('clicking "Search Memory for …" commits the same as Enter', async () => {
    renderAt('/memory');

    const input = screen.getByRole('textbox');
    engage(input);
    fireEvent.change(input, { target: { value: 'latte' } });

    fireEvent.click(await screen.findByText('Search Memory for'));

    await waitFor(() => expect(params().get('search')).toBe('latte'));
  });
});

describe('GlobalSearchBox off /memory (jump-to launcher)', () => {
  it('does not write the current route while typing — only the "jump to" suggestions react', async () => {
    renderAt('/dashboard');

    const input = screen.getByRole('textbox');
    engage(input);
    fireEvent.change(input, { target: { value: 'latte' } });

    // The action row is driven by the same debounced state as the URL write
    // on /memory; its appearance proves the debounce landed.
    await screen.findByText('Search all of Memory for');

    expect(path()).toBe('/dashboard');
    expect(params().toString()).toBe('');
  });

  it('Enter navigates to /memory?search=…, carrying forward pinned filters already on the URL', () => {
    renderAt('/dashboard?tags=vacation');

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'latte' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(path()).toBe('/memory');
    expect(params().get('search')).toBe('latte');
    expect(params().get('tags')).toBe('vacation');
  });

  it('X on a /memory sub-route resets back to the bare hub, dropping its filters', () => {
    renderAt('/memory/people/42?tags=vacation');

    fireEvent.click(screen.getByRole('button', { name: /clear search and filters/i }));

    expect(path()).toBe('/memory');
    expect(params().toString()).toBe('');
  });
});

describe('GlobalSearchBox suggestions', () => {
  it('shows recent searches on focus and commits the one clicked', () => {
    localStorage.setItem('memoryRecentSearches', JSON.stringify(['latte']));
    renderAt('/memory');

    engage(screen.getByRole('textbox'));
    fireEvent.click(screen.getByText('latte'));

    expect(params().get('search')).toBe('latte');
  });

  it('removing a recent search does not commit it', () => {
    localStorage.setItem('memoryRecentSearches', JSON.stringify(['latte']));
    renderAt('/memory');

    engage(screen.getByRole('textbox'));
    fireEvent.click(screen.getByRole('button', { name: /remove.*latte.*from recent searches/i }));

    expect(screen.queryByText('latte')).not.toBeInTheDocument();
    expect(params().has('search')).toBe(false);
  });

  it('selecting a matching tag filters the explorer by tag, not by free text', async () => {
    h.search = { data: [], tags: [{ id: 't1', label: 'vacation' }], loading: false, error: undefined };
    renderAt('/dashboard');

    const input = screen.getByRole('textbox');
    engage(input);
    fireEvent.change(input, { target: { value: 'vac' } });

    fireEvent.click(await screen.findByText('#vacation'));

    expect(path()).toBe('/memory');
    expect(params().get('tags')).toBe('vacation');
    expect(params().has('search')).toBe(false);
  });

  it('selecting a person suggestion decodes its GlobalUID and opens the detail route', async () => {
    h.search = {
      data: [
        { __typename: 'PersonType', id: GlobalUID.encode('person', '42'), name: 'Alice', filterName: 'Alice' },
      ],
      tags: [],
      loading: false,
      error: undefined,
    };
    renderAt('/dashboard');

    const input = screen.getByRole('textbox');
    engage(input);
    fireEvent.change(input, { target: { value: 'ali' } });

    fireEvent.click(await screen.findByText('Alice'));

    expect(path()).toBe('/people/42');
  });
});
