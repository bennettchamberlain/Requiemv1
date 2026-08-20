import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EntityMedia } from './EntityDetailScaffold';

/**
 * The detail pane renders the ORIGINAL image, painting the low-res PREVIEW
 * only while the original downloads. jsdom never loads images, so the probe
 * `Image` is stubbed with a controllable fake: the test decides when (and for
 * which src) onload fires.
 */
class FakeImage {
  static instances: FakeImage[] = [];

  onload: (() => void) | null = null;

  src = '';

  constructor() {
    FakeImage.instances.push(this);
  }
}

const ORIGINAL = '/static/companion/original';
const PREVIEW = '/static/companion/preview';

describe('EntityMedia progressive image', () => {
  beforeEach(() => {
    FakeImage.instances = [];
    vi.stubGlobal('Image', FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('paints the preview first, then swaps to the original when it loads', () => {
    render(<EntityMedia src={ORIGINAL} previewSrc={PREVIEW} contentType="image/jpeg" alt="photo" />);

    // Preview immediately; the original is being probed off-DOM.
    expect(screen.getByAltText('photo')).toHaveAttribute('src', PREVIEW);
    expect(FakeImage.instances).toHaveLength(1);
    expect(FakeImage.instances[0].src).toBe(ORIGINAL);

    act(() => FakeImage.instances[0].onload?.());

    expect(screen.getByAltText('photo')).toHaveAttribute('src', ORIGINAL);
  });

  it('renders the original directly when no preview exists', () => {
    render(<EntityMedia src={ORIGINAL} contentType="image/jpeg" alt="photo" />);

    expect(screen.getByAltText('photo')).toHaveAttribute('src', ORIGINAL);
    expect(FakeImage.instances).toHaveLength(0);
  });

  it('renders the preview when the original url is missing', () => {
    render(<EntityMedia src={null} previewSrc={PREVIEW} contentType="image/jpeg" alt="photo" />);

    expect(screen.getByAltText('photo')).toHaveAttribute('src', PREVIEW);
  });

  it('does not swap the new preview for a STALE original after the entity changes', () => {
    const { rerender } = render(
      <EntityMedia src={ORIGINAL} previewSrc={PREVIEW} contentType="image/jpeg" alt="photo" />,
    );

    rerender(
      <EntityMedia src="/static/companion/other" previewSrc="/static/companion/other-preview" contentType="image/jpeg" alt="photo" />,
    );

    // The first probe finishing late must not flip the src: its onload was
    // detached on cleanup, and the shown src tracks the CURRENT original only.
    act(() => FakeImage.instances[0].onload?.());
    expect(screen.getByAltText('photo')).toHaveAttribute('src', '/static/companion/other-preview');

    act(() => FakeImage.instances[1].onload?.());
    expect(screen.getByAltText('photo')).toHaveAttribute('src', '/static/companion/other');
  });
});
