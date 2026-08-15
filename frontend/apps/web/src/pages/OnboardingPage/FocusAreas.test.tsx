import { Form, formDataResolver, formDataSchema as s, useForm } from '@ci/shadcn';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FocusAreas } from './FocusAreas';

const schema = s.object({
  focus_areas: s.array(s.string()).nullable().default(null),
});

function FocusAreasHarness() {
  const form = useForm({
    resolver: formDataResolver(schema),
    defaultValues: { focus_areas: null },
  });

  return (
    <Form {...form}>
      <FocusAreas />
    </Form>
  );
}

describe('FocusAreas', () => {
  it('toggles when clicking the tile label text, not only the checkbox', () => {
    render(<FocusAreasHarness />);

    const tile = screen.getByText('Personal fitness and health').closest('label');
    expect(tile).toBeTruthy();

    fireEvent.click(tile!);

    expect(screen.getByRole('checkbox', { name: /personal fitness and health/i })).toBeChecked();

    fireEvent.click(tile!);

    expect(screen.getByRole('checkbox', { name: /personal fitness and health/i })).not.toBeChecked();
  });
});
