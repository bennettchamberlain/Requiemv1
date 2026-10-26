import { Editor } from '@ci/editor';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The real editor, driven the way a person does: Enter and the list and quote
 * buttons. Each of these builds new nodes, and when two copies of
 * prosemirror-model are installed they throw "Can not convert <> to a
 * Fragment (looks like multiple versions of prosemirror-model were loaded)"
 * and leave the note unchanged.
 */
describe('note editor commands', () => {
  beforeAll(() => {
    // jsdom has no layout. ProseMirror measures the selection to scroll it into
    // view after each change, so give ranges an empty box to measure.
    Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
    Range.prototype.getBoundingClientRect ??= () => new DOMRect();
  });

  function renderEditor() {
    const onUpdate = vi.fn<(content: string) => void>();

    render(
      <Editor content="<p>Shopping list</p>" onUpdate={onUpdate}>
        <Editor.Menu />
        <Editor.Content />
      </Editor>,
    );

    return { onUpdate, lastHtml: () => onUpdate.mock.lastCall?.[0] };
  }

  async function prosemirror() {
    let node: HTMLElement | null = null;

    await waitFor(() => {
      node = document.querySelector<HTMLElement>('.ProseMirror');
      expect(node).not.toBeNull();
    });

    return node as unknown as HTMLElement;
  }

  it('starts a new paragraph on Enter', async () => {
    const { lastHtml } = renderEditor();
    const editable = await prosemirror();

    // Put the caret after "Shopping list", where a person starts the next line.
    const text = editable.querySelector('p')?.firstChild as Text;
    editable.focus();
    window.getSelection()?.collapse(text, text.length);
    document.dispatchEvent(new Event('selectionchange'));
    // ProseMirror reads a DOM selection change on a short timer, not at once.
    await new Promise((resolve) => setTimeout(resolve, 100));

    fireEvent.keyDown(editable, { key: 'Enter', code: 'Enter', keyCode: 13 });

    await waitFor(() => expect(lastHtml()).toBe('<p>Shopping list</p><p></p>'));
  });

  it.each([
    ['Bulleted list', '<ul>'],
    ['Numbered list', '<ol>'],
    ['Quote', '<blockquote>'],
  ])('%s wraps the paragraph', async (name, tag) => {
    const { lastHtml } = renderEditor();
    await prosemirror();

    fireEvent.click(screen.getByRole('button', { name }));

    await waitFor(() => expect(lastHtml()).toContain(tag));
    expect(lastHtml()).toContain('Shopping list');
  });
});
