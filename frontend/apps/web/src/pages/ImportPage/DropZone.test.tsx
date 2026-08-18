import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DropZone } from './DropZone';

/**
 * A directory entry whose `createReader().readEntries` always errors, so a
 * real drop through `collectDroppedFiles` rejects and exercises the zone's
 * "could not read that folder" branch — not just its two success fallbacks.
 */
function unreadableDirectoryEntry() {
  return {
    isFile: false,
    isDirectory: true,
    name: 'broken-export',
    fullPath: '/broken-export',
    createReader: () => ({
      readEntries: (_ok: unknown, err: (error: DOMException) => void) => {
        err(new DOMException('permission denied'));
      },
    }),
  };
}

function dataTransferWithEntries(entries: unknown[]) {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
    files: [],
  } as unknown as DataTransfer;
}

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

  describe('drag highlight', () => {
    it('highlights on dragenter and clears once every dragleave is accounted for', () => {
      render(<DropZone onFiles={vi.fn()} />);

      const zone = screen.getByTestId('import-dropzone');

      expect(zone).toHaveAttribute('data-active', 'false');
      expect(zone.className).not.toMatch(/bg-primary\/5/);

      // dragenter/dragleave fire for every child element the pointer crosses —
      // two enters (e.g. the icon, then the text) must not go inactive after
      // only one leave.
      fireEvent.dragEnter(zone);
      fireEvent.dragEnter(zone);

      expect(zone).toHaveAttribute('data-active', 'true');
      expect(zone.className).toMatch(/bg-primary\/5/);

      fireEvent.dragLeave(zone);

      expect(zone).toHaveAttribute('data-active', 'true');

      fireEvent.dragLeave(zone);

      expect(zone).toHaveAttribute('data-active', 'false');
      expect(zone.className).not.toMatch(/bg-primary\/5/);
    });

    it('never goes negative on an unmatched leave', () => {
      render(<DropZone onFiles={vi.fn()} />);

      const zone = screen.getByTestId('import-dropzone');

      fireEvent.dragLeave(zone);
      fireEvent.dragLeave(zone);
      fireEvent.dragEnter(zone);

      // A stray leave (e.g. from before the depth counter existed) must not
      // leave the counter negative, or one real enter would be swallowed.
      expect(zone).toHaveAttribute('data-active', 'true');
    });

    it('does not highlight while disabled', () => {
      render(<DropZone onFiles={vi.fn()} disabled />);

      const zone = screen.getByTestId('import-dropzone');

      fireEvent.dragEnter(zone);

      expect(zone).toHaveAttribute('data-active', 'false');
    });
  });

  describe('drop', () => {
    it('resets the highlight and emits files from a real drop', async () => {
      const onFiles = vi.fn();

      render(<DropZone onFiles={onFiles} />);

      const zone = screen.getByTestId('import-dropzone');
      const file = new File(['x'], 'takeout.zip', { type: 'application/zip' });

      fireEvent.dragEnter(zone);
      expect(zone).toHaveAttribute('data-active', 'true');

      fireEvent.drop(zone, { dataTransfer: { items: [], files: [file] } });

      // collectDroppedFiles is async even on its synchronous fallback path —
      // the walk resolves a tick after the drop event handler returns.
      await waitFor(() => expect(onFiles).toHaveBeenCalledWith([file]));
      expect(zone).toHaveAttribute('data-active', 'false');
    });

    it('fires onCollectStart before the walk resolves', () => {
      const onCollectStart = vi.fn();
      const onFiles = vi.fn();

      render(<DropZone onFiles={onFiles} onCollectStart={onCollectStart} />);

      fireEvent.drop(screen.getByTestId('import-dropzone'), {
        dataTransfer: { items: [], files: [new File(['x'], 'a.zip')] },
      });

      expect(onCollectStart).toHaveBeenCalled();
    });

    it('shows "nothing readable" when the drop yields no usable files', async () => {
      const onFiles = vi.fn();

      render(<DropZone onFiles={onFiles} />);

      // A 0-byte, typeless entry is exactly the directory placeholder Chromium
      // hands back — collectDroppedFiles' real fallback filters it out.
      const placeholder = new File([], 'some-export');

      fireEvent.drop(screen.getByTestId('import-dropzone'), {
        dataTransfer: { items: [], files: [placeholder] },
      });

      expect(
        await screen.findByText(/nothing readable in that drop\. choose a folder, or drop the \.zip\./i),
      ).toBeInTheDocument();
      expect(onFiles).not.toHaveBeenCalled();
    });

    it('shows "could not read that folder" when the walk itself fails', async () => {
      const onFiles = vi.fn();

      render(<DropZone onFiles={onFiles} />);

      fireEvent.drop(screen.getByTestId('import-dropzone'), {
        dataTransfer: dataTransferWithEntries([unreadableDirectoryEntry()]),
      });

      expect(
        await screen.findByText(/could not read that folder\. choose folder, or drop the \.zip\./i),
      ).toBeInTheDocument();
      expect(onFiles).not.toHaveBeenCalled();
    });

    it('clears a previous drop error once a later drop succeeds', async () => {
      const onFiles = vi.fn();

      render(<DropZone onFiles={onFiles} />);

      const zone = screen.getByTestId('import-dropzone');

      fireEvent.drop(zone, { dataTransfer: { items: [], files: [new File([], 'placeholder')] } });
      expect(await screen.findByText(/nothing readable in that drop/i)).toBeInTheDocument();

      fireEvent.drop(zone, { dataTransfer: { items: [], files: [new File(['x'], 'export.zip')] } });

      await waitFor(() =>
        expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'export.zip' })]),
      );
      expect(screen.queryByText(/nothing readable in that drop/i)).not.toBeInTheDocument();
    });

    it('does nothing on drop while disabled', () => {
      const onFiles = vi.fn();

      render(<DropZone onFiles={onFiles} disabled />);

      fireEvent.drop(screen.getByTestId('import-dropzone'), {
        dataTransfer: { items: [], files: [new File(['x'], 'export.zip')] },
      });

      expect(onFiles).not.toHaveBeenCalled();
    });
  });
});
