import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { makeFragmentData } from '@/graphql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { FILE_FRAGMENT, FileRow } from './FileRow';

function makeFile(overrides: Record<string, unknown> = {}) {
  return makeFragmentData(
    {
      __typename: 'FileType' as const,
      id: 'f1',
      filename: 'photo.jpg',
      title: 'Photo',
      previewUrl: null,
      sourceUrl: null,
      contentType: 'image/jpeg',
      ...overrides,
    },
    FILE_FRAGMENT,
  );
}

describe('FileRow', () => {
  it('renders a thumb from previewUrl when present', () => {
    renderWithProviders(<FileRow file={makeFile({ previewUrl: '/p/thumb.jpg' })} />);

    expect(screen.getByRole('img')).toHaveAttribute('src', '/static/p/thumb.jpg');
  });

  it('falls back to sourceUrl for image/png when preview is missing', () => {
    renderWithProviders(
      <FileRow
        file={makeFile({
          filename: 'capture.png',
          contentType: 'image/png',
          previewUrl: null,
          sourceUrl: '/u/shot.png',
        })}
      />,
    );

    expect(screen.getByRole('img')).toHaveAttribute('src', '/static/u/shot.png');
  });
});
