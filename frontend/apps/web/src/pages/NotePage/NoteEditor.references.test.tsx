import { Editor, type EntityReferenceConfig } from '@ci/editor';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

/**
 * A `[[` reference is stored only in the note's HTML, as
 * `<a data-entity-uid="…">`. Loading that HTML back must give the reference
 * node again. StarterKit's Link mark matches the same anchor, and if it wins
 * the reference turns into a plain link the next time the note opens.
 */

const reference: EntityReferenceConfig = {
  search: async () => [],
  resolveHref: ({ uid }) => `/people/${uid}`,
};

const SAVED =
  '<p>Trip ideas with <a data-entity-uid="cGVyc29uOjE=" data-entity-type="person" data-entity-label="John Doe" ' +
  'href="/people/cGVyc29uOjE=" class="ci-entity-reference">John Doe</a> </p>';

describe('note editor references', () => {
  it('loads a saved reference as a reference, not a plain link', async () => {
    render(
      <Editor content={SAVED} reference={reference}>
        <Editor.Content />
      </Editor>,
    );

    let anchor: HTMLAnchorElement | null = null;

    await waitFor(() => {
      anchor = document.querySelector<HTMLAnchorElement>('.ProseMirror a');
      expect(anchor).not.toBeNull();
    });

    const link = anchor as unknown as HTMLAnchorElement;
    expect(link.getAttribute('data-entity-uid')).toBe('cGVyc29uOjE=');
    expect(link.getAttribute('data-entity-type')).toBe('person');
    expect(link.getAttribute('data-entity-label')).toBe('John Doe');
    // The Link mark renders target="_blank"; the reference doesn't.
    expect(link.getAttribute('target')).toBeNull();
  });

  it('still loads an ordinary link as a link', async () => {
    render(
      <Editor content='<p>See <a href="https://example.com/">the site</a></p>' reference={reference}>
        <Editor.Content />
      </Editor>,
    );

    await waitFor(() => {
      const link = document.querySelector<HTMLAnchorElement>('.ProseMirror a');
      expect(link?.getAttribute('href')).toBe('https://example.com/');
      expect(link?.hasAttribute('data-entity-uid')).toBe(false);
    });
  });
});
