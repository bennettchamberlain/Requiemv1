import { describe, expect, it, vi } from 'vitest';

import { pickPhotosFromLibrary } from './pickPhotosFromLibrary';

describe('pickPhotosFromLibrary', () => {
  it('opens a hidden image file input (PHPicker on iOS, no library permission)', async () => {
    const click = vi.fn();
    const original = document.createElement.bind(document);

    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = original(tag);

      if (tag === 'input') {
        el.click = click;
      }

      return el;
    });

    const pending = pickPhotosFromLibrary({ multiple: false });
    const input = document.body.querySelector('input[type="file"]') as HTMLInputElement;

    expect(input.accept).toBe('image/*');
    expect(input.multiple).toBe(false);
    expect(click).toHaveBeenCalled();

    input.dispatchEvent(new Event('cancel'));
    await expect(pending).resolves.toEqual([]);
  });
});
