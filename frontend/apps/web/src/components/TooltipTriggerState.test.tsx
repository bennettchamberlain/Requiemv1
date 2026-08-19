import { IconButton, Toggle, Tooltip } from '@ci/shadcn';
import { X } from '@ci/shadcn/icons';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

// `Tooltip.Trigger` writes its own `data-state` (closed / delayed-open), and Radix's
// Slot only lets the child win for props the child itself declares. So making a
// stateful Radix control the *direct* child of `Tooltip.Trigger` overwrites its
// state attribute — every `data-[state=on]` / `data-[state=open]` style silently
// stops matching while behaviour and aria-* stay correct, which makes the bug
// invisible to both review and ordinary tests.
//
// These tests pin the two safe shapes documented in
// docs/frontend/tooltips-and-i18n.md.
describe('Tooltip.Trigger and data-state', () => {
  it('REGRESSION: wrapping a Toggle directly destroys its pressed state', () => {
    render(
      <Tooltip>
        <Tooltip.Content>tip</Tooltip.Content>
        <Tooltip.Trigger asChild>
          <Toggle pressed aria-label="direct">
            <X />
          </Toggle>
        </Tooltip.Trigger>
      </Tooltip>,
    );

    // Documents the trap rather than endorsing it: if a future Radix release fixes
    // the merge order, this flips and the span wrappers can be removed.
    expect(screen.getByRole('button', { name: 'direct' })).not.toHaveAttribute('data-state', 'on');
  });

  it('a span between the trigger and a Toggle preserves data-state=on', () => {
    render(
      <Tooltip>
        <Tooltip.Content>tip</Tooltip.Content>
        <Tooltip.Trigger asChild>
          <span className="inline-flex">
            <Toggle pressed aria-label="spanned">
              <X />
            </Toggle>
          </span>
        </Tooltip.Trigger>
      </Tooltip>,
    );

    const el = screen.getByRole('button', { name: 'spanned' });
    expect(el).toHaveAttribute('data-state', 'on');
    expect(el).toHaveAttribute('aria-pressed', 'true');
  });

  it('IconButton is immune — incoming props land on the Button element and win', () => {
    render(
      <Tooltip>
        <Tooltip.Content>outer</Tooltip.Content>
        <Tooltip.Trigger asChild>
          <IconButton label="nested" data-state="open">
            <X />
          </IconButton>
        </Tooltip.Trigger>
      </Tooltip>,
    );

    expect(screen.getByRole('button', { name: 'nested' })).toHaveAttribute('data-state', 'open');
  });
});
