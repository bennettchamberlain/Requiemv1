import { DropdownMenu, Tooltip } from '@ci/shadcn';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The Add and account menus wrap each entry in a tooltip, which puts
// `Tooltip.Trigger asChild` directly around `DropdownMenu.Item`. That is only safe
// because `DropdownMenuItem` styles on data-[highlighted] / data-[disabled] /
// data-[variant] and never on `data-state` — the attribute `Tooltip.Trigger`
// overwrites (see docs/frontend/tooltips-and-i18n.md).
//
// These pin the two things that would break silently: selection still firing
// through the extra Slot layer, and the item keeping the attributes its styles key
// off. If a future shadcn bump makes DropdownMenuItem style on data-state, the last
// test fails and the wrapping has to move.
describe('tooltip-wrapped dropdown menu items', () => {
  const renderMenu = (onSelect: () => void) =>
    render(
      <DropdownMenu open modal={false}>
        <DropdownMenu.Trigger>open</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <Tooltip delayDuration={600}>
            <Tooltip.Content side="top" className="pointer-events-none">
              Run the prediction pipeline now
            </Tooltip.Content>
            <Tooltip.Trigger asChild>
              <DropdownMenu.Item onSelect={onSelect}>Predict</DropdownMenu.Item>
            </Tooltip.Trigger>
          </Tooltip>
        </DropdownMenu.Content>
      </DropdownMenu>,
    );

  it('still fires onSelect through the tooltip Slot layer', () => {
    const onSelect = vi.fn();
    renderMenu(onSelect);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Predict' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('keeps the attributes DropdownMenuItem styles on', () => {
    renderMenu(vi.fn());

    const item = screen.getByRole('menuitem', { name: 'Predict' });
    // `Tooltip.Trigger` overwrites `data-slot` the same way it overwrites
    // `data-state`. Harmless here: `dropdown-menu-item` is written but never read —
    // the only [data-slot=…] rules in source CSS target button, checkbox and switch.
    // Asserted so that changing it to a styling hook trips this test.
    expect(item).toHaveAttribute('data-slot', 'tooltip-trigger');
    // These are untouched by the tooltip and do drive styles.
    expect(item).toHaveAttribute('data-variant', 'default');
    // Not disabled — data-[disabled] would kill pointer events and with them the
    // hover that opens the tooltip in the first place.
    expect(item).not.toHaveAttribute('data-disabled');
  });

  it('DropdownMenuItem does not key any style off data-state', () => {
    // The guard behind the whole approach. `Tooltip.Trigger` owns data-state on this
    // node, so a shadcn bump that starts styling menu items on it would break them
    // invisibly, exactly as it did for Toggle. No className is passed in renderMenu,
    // so this is DropdownMenuItem's own class list.
    renderMenu(vi.fn());

    expect(screen.getByRole('menuitem', { name: 'Predict' }).className).not.toContain('data-[state');
  });
});
