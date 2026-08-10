import { IconButton } from '@ci/shadcn';
import { X } from '@ci/shadcn/icons';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// IconButton is the house wrapper for every icon-only control: it derives the
// tooltip text and the accessible name from one `label` prop so the two can never
// drift apart. These tests guard that contract — the hover tooltip itself is Radix
// behaviour and needs a real pointer, so it is covered in e2e rather than jsdom.
describe('IconButton', () => {
  it('uses label as the accessible name', () => {
    render(
      <IconButton label="Delete note">
        <X />
      </IconButton>,
    );

    const button = screen.getByRole('button', { name: 'Delete note' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label', 'Delete note');
  });

  it('defaults to the icon size and forwards variant/className', () => {
    render(
      <IconButton label="Close" variant="ghost" className="absolute">
        <X />
      </IconButton>,
    );

    const button = screen.getByRole('button', { name: 'Close' });
    expect(button).toHaveClass('size-9');
    expect(button).toHaveClass('absolute');
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(
      <IconButton label="Refresh" onClick={onClick}>
        <X />
      </IconButton>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('still renders an accessible name when disabled', () => {
    // Disabled buttons are wrapped in a span so the tooltip can still be hovered;
    // that wrapper must not cost the button its accessible name.
    render(
      <IconButton label="Save credentials" disabled>
        <X />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Save credentials' })).toBeDisabled();
  });

  it('label wins over an aria-label that reaches it past the type', () => {
    // `aria-label` is Omit-ed from IconButtonProps, so this needs a cast to compile —
    // which is the point. The type stops the honest caller; this pins the runtime
    // guarantee for the ones it can't see (untyped spreads, JS callers, casts), so
    // the tooltip and the accessible name cannot disagree.
    const sneaky = { 'aria-label': 'Something else' } as Record<string, unknown>;
    render(
      <IconButton label="Delete note" {...sneaky}>
        <X />
      </IconButton>,
    );

    expect(screen.getByRole('button', { name: 'Delete note' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Something else' })).not.toBeInTheDocument();
  });

  it('supports asChild for link triggers', () => {
    render(
      <IconButton label="Create connection" asChild>
        <a href="/connect">
          <X />
        </a>
      </IconButton>,
    );

    expect(screen.getByRole('link', { name: 'Create connection' })).toHaveAttribute('href', '/connect');
  });
});
