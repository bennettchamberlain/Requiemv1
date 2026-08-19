import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EntityEditToggle } from './EntityEditToggle';

describe('EntityEditToggle', () => {
  it('reports the flipped pressed state on click, both ways', () => {
    const onPressedChange = vi.fn();
    const { rerender } = render(<EntityEditToggle pressed={false} onPressedChange={onPressedChange} />);

    const toggle = screen.getByRole('button');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(onPressedChange).toHaveBeenCalledWith(true);

    // The toggle is controlled — re-render with the new prop, as the entity page would after
    // handling the callback, and confirm the click flips it back off too.
    rerender(<EntityEditToggle pressed onPressedChange={onPressedChange} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button'));
    expect(onPressedChange).toHaveBeenCalledWith(false);
    expect(onPressedChange).toHaveBeenCalledTimes(2);
  });
});
