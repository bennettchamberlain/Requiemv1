import { act, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { gql } from '@/graphql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { DailySeries } from './DailySeries';

const GET_DAILY_METRICS = gql(`
  query StatsDailyMetrics($from: String!, $to: String!) {
    dailyMetrics(from: $from, to: $to) {
      date
      nMessages
      nPlaces
      kmTraveled
    }
  }
`);

function metricsMock(rows: Array<{ date: string; nMessages: number; nPlaces: number; kmTraveled: number }>) {
  return {
    request: { query: GET_DAILY_METRICS, variables: { from: '2026-01-01', to: '2026-01-03' } },
    result: { data: { dailyMetrics: rows } },
  };
}

beforeEach(() => {
  // jsdom reports every element as 0x0, which makes recharts' ResponsiveContainer
  // skip rendering its children entirely — there would be nothing to assert on.
  // A plain reassignment (not `vi.spyOn`) survives the config's `restoreMocks: true`,
  // which would otherwise revert a spy set up once in `beforeAll` after the first test.
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      width: 500,
      height: 224,
      top: 0,
      left: 0,
      bottom: 224,
      right: 500,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
});

describe('DailySeries', () => {
  it('renders nothing while the range has no daily metrics', async () => {
    const { container } = renderWithProviders(<DailySeries from="2026-01-01" to="2026-01-03" />, {
      mocks: [metricsMock([])],
    });

    // Give the query a tick to resolve before asserting the still-empty render.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Daily series')).not.toBeInTheDocument();
  });

  it('draws the chart once the range has data, converting rows into a real line series', async () => {
    const { container } = renderWithProviders(<DailySeries from="2026-01-01" to="2026-01-03" />, {
      mocks: [
        metricsMock([
          { date: '2026-01-01', nMessages: 12, nPlaces: 2, kmTraveled: 5.5 },
          { date: '2026-01-02', nMessages: 20, nPlaces: 1, kmTraveled: 0 },
          { date: '2026-01-03', nMessages: 7, nPlaces: 3, kmTraveled: 12.25 },
        ]),
      ],
    });

    expect(await screen.findByText('Daily series')).toBeInTheDocument();

    // Actual chart output, not just the card wrapper — one drawn curve per
    // series (messages, places, km traveled), each with a real plotted path
    // rather than an empty/degenerate one. jsdom gives every element the same
    // stubbed width, which makes recharts' own tick-collision heuristics drop
    // axis tick labels unpredictably, so the curves (not tick text) are the
    // stable signal that the rows actually reached the chart.
    const curves = container.querySelectorAll('.recharts-line-curve');
    expect(curves).toHaveLength(3);
    curves.forEach((curve) => {
      expect(curve.getAttribute('d')).toMatch(/^M\d/);
    });
  });
});
