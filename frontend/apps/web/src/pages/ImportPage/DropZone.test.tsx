import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DropZone } from './DropZone';

describe('DropZone', () => {
  it('offers both a file picker and a folder picker', () => {
    render(<DropZone onFiles={vi.fn()} />);

    expect(screen.getByRole('button', { name: /choose files/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /choose folder/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/choose export files/i)).not.toHaveAttribute('webkitdirectory');
    expect(screen.getByLabelText(/choose an export folder/i)).toHaveAttribute('webkitdirectory');
  });

  it('emits files chosen from the file picker', () => {
    const onFiles = vi.fn();

    render(<DropZone onFiles={onFiles} />);

    const input = screen.getByLabelText(/choose export files/i);
    const file = new File(['x'], 'export.zip', { type: 'application/zip' });

    fireEvent.change(input, { target: { files: [file] } });

    expect(onFiles).toHaveBeenCalledWith([file]);
  });
});
