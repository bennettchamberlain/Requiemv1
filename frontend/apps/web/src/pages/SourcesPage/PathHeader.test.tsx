/**
 * Every path opens the same way — name, what it costs, what you get — so
 * moving between them changes the answers and not the shape. This is where the
 * `Effort`/`You get` pair lives now: on the tiles it made three tiles three
 * different heights and pushed the content below the fold.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PathHeader } from './PathHeader';
import { SOURCE_PATHS, SOURCE_PATH_INFO } from './SourcePathTiles';

describe('PathHeader', () => {
  it.each(SOURCE_PATHS)('introduces the %s path in the same shape as the others', (path) => {
    render(<PathHeader path={path} />);

    const info = SOURCE_PATH_INFO[path];

    expect(screen.getByRole('heading', { name: info.title })).toBeInTheDocument();
    expect(screen.getByText('Effort')).toBeInTheDocument();
    expect(screen.getByText(info.effort)).toBeInTheDocument();
    expect(screen.getByText('You get')).toBeInTheDocument();
    expect(screen.getByText(info.gets)).toBeInTheDocument();
  });
});
