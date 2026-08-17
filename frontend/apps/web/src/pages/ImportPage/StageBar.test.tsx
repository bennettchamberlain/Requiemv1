import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StageBar } from './StageBar';

/**
 * The rule this component exists to hold: it never fabricates a percentage.
 *
 * The three bars it replaced upstream each guessed differently — a hardcoded
 * 70%, a `Math.min(95, …)`, and no bar at all — so one import could read 70%
 * done and 8% done on two screens at the same time.
 */

describe('StageBar', () => {
  it('reports a real percentage when there is a denominator', () => {
    render(<StageBar processed={25} total={100} status="running" />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  });

  it('reports NO value when the work is not yet countable', () => {
    // A parse discovers its total. Until then the bar must say "working", not
    // "0%" — which reads as a stalled import — and not a guess.
    render(<StageBar processed={412} total={null} status="running" />);

    const bar = screen.getByRole('progressbar');

    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-label', 'Working');
  });

  it('shows the live count while indeterminate, so something is still moving', () => {
    render(<StageBar processed={12_400} total={null} status="running" />);

    expect(screen.getByText('12.4k')).toBeInTheDocument();
  });

  it('shows both numbers once there is a denominator', () => {
    render(<StageBar processed={12_400} total={88_000} status="running" />);

    expect(screen.getByText('12.4k / 88.0k')).toBeInTheDocument();
  });

  it('reads full for a completed stage that never had a total', () => {
    // An unpack finishes without ever counting; leaving it visually empty would
    // say the opposite of what happened.
    render(<StageBar processed={1} total={null} status="completed" />);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('drops the readout in compact mode', () => {
    render(<StageBar processed={12_400} total={88_000} status="running" compact />);

    expect(screen.queryByText('12.4k / 88.0k')).not.toBeInTheDocument();
  });
});
