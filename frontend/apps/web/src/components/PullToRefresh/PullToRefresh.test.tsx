import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { PullToRefresh } from './PullToRefresh';

const originalMatchMedia = window.matchMedia;

function stubViewport(mobile: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: mobile && query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function list() {
  return (
    <div data-page-scroll="" data-testid="scroller" style={{ height: 200, overflow: 'auto' }}>
      <div style={{ height: 400 }}>People</div>
    </div>
  );
}

describe('PullToRefresh', () => {
  it('is inert on desktop', () => {
    stubViewport(false);
    const onRefresh = vi.fn();

    renderWithProviders(<PullToRefresh onRefresh={onRefresh}>{list()}</PullToRefresh>);

    expect(screen.queryByTestId('pull-to-refresh')).not.toBeInTheDocument();
    fireEvent.touchStart(screen.getByTestId('scroller'), { touches: [{ clientY: 8 }] });
    fireEvent.touchMove(screen.getByTestId('scroller'), { touches: [{ clientY: 120 }] });
    fireEvent.touchEnd(screen.getByTestId('scroller'));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('refetches after a downward pull at the top of a Memory list', async () => {
    stubViewport(true);
    const onRefresh = vi.fn(() => Promise.resolve());

    renderWithProviders(<PullToRefresh onRefresh={onRefresh}>{list()}</PullToRefresh>);

    await screen.findByTestId('pull-to-refresh');

    const scroller = screen.getByTestId('scroller');
    fireEvent.touchStart(scroller, { touches: [{ identifier: 0, clientY: 10 }] });
    fireEvent.touchMove(scroller, { touches: [{ identifier: 0, clientY: 160 }] });
    fireEvent.touchEnd(scroller);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });
});
