import { Form, formDataResolver, formDataSchema as s, useForm } from '@ci/shadcn';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FocusAreas } from './FocusAreas';

const schema = s.object({
  focus_areas: s.array(s.string()).nullable().default(null),
});

function FocusAreasHarness({ onSubmit }: { onSubmit?: (event: React.FormEvent) => void }) {
  const form = useForm({
    resolver: formDataResolver(schema),
    defaultValues: { focus_areas: null },
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit}>
        <FocusAreas />
      </form>
    </Form>
  );
}

describe('FocusAreas', () => {
  it('toggles when clicking the tile title, not only the checkbox', () => {
    render(<FocusAreasHarness />);

    const tile = screen.getByRole('checkbox', { name: /personal fitness and health/i });
    fireEvent.click(screen.getByText('Personal fitness and health'));

    expect(tile).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(screen.getByText('Personal fitness and health'));

    expect(tile).toHaveAttribute('aria-checked', 'false');
  });

  it('toggles when clicking the checkbox control itself', () => {
    render(<FocusAreasHarness />);

    const tile = screen.getByRole('checkbox', { name: /personal fitness and health/i });
    fireEvent.click(tile);

    expect(tile).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(tile);

    expect(tile).toHaveAttribute('aria-checked', 'false');
  });

  it('does not submit the surrounding form when clicking a tile', () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(<FocusAreasHarness onSubmit={onSubmit} />);

    fireEvent.click(screen.getByText('Personal fitness and health'));
    fireEvent.click(screen.getByRole('checkbox', { name: /communication management/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
