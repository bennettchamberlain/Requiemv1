import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { makeFragmentData } from '@/graphql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { FILE_CHUNK_FRAGMENT, FileChunkGridItem } from './FileChunkGridItem';

function makeFileChunk(overrides: Record<string, unknown> = {}) {
  return makeFragmentData(
    {
      __typename: 'FileChunkType' as const,
      id: 'fc1',
      sectionTitle: null,
      chunkContent: 'Some long excerpt of the document body goes here.',
      sourceLocator: null,
      file: { id: 'f1', filename: 'report.pdf' },
      ...overrides,
    },
    FILE_CHUNK_FRAGMENT,
  );
}

describe('FileChunkGridItem', () => {
  it('titles the tile from the section, and subtitles it with the filename', () => {
    renderWithProviders(
      <FileChunkGridItem
        fileChunk={makeFileChunk({ sectionTitle: 'Q3 Results', file: { id: 'f1', filename: 'report.pdf' } })}
      />,
    );

    expect(screen.getByText('Q3 Results')).toBeInTheDocument();
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
    expect(screen.getByText('Document excerpt')).toBeInTheDocument();
  });

  it('falls back to the filename as the title when there is no section title', () => {
    renderWithProviders(
      <FileChunkGridItem
        fileChunk={makeFileChunk({ sectionTitle: null, file: { id: 'f1', filename: 'notes.txt' } })}
      />,
    );

    // The filename is used as both the title (no section) and, again, in the subtitle line.
    expect(screen.getAllByText('notes.txt').length).toBeGreaterThan(0);
  });

  it('renders a page locator alongside the filename in the subtitle', () => {
    renderWithProviders(
      <FileChunkGridItem
        fileChunk={makeFileChunk({
          sectionTitle: 'Intro',
          file: { id: 'f1', filename: 'handbook.pdf' },
          sourceLocator: { page: 4 },
        })}
      />,
    );

    expect(screen.getByText('handbook.pdf • Page 4')).toBeInTheDocument();
  });

  it('truncates a long excerpt with an ellipsis', () => {
    const long = 'a'.repeat(400);

    renderWithProviders(<FileChunkGridItem fileChunk={makeFileChunk({ chunkContent: long })} />);

    expect(screen.getByText(`${'a'.repeat(320)}...`)).toBeInTheDocument();
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    renderWithProviders(
      <FileChunkGridItem fileChunk={makeFileChunk({ sectionTitle: 'Clickable' })} onClick={onClick} />,
    );

    fireEvent.click(screen.getByText('Clickable'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
