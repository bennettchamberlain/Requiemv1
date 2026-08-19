import { useEffect } from 'react';

/**
 * Set the document title for as long as this component is mounted.
 *
 * `null` means "not mine to set" — for a page component being rendered INSIDE
 * another page, which owns the title. The hook still runs unconditionally (it
 * is a hook), it simply declines to write. Without this an embedded page's
 * effect would fire after its host's and quietly win, so composing two pages
 * would leave the browser tab naming the inner one.
 */
export function usePageTitle(title: string | null) {
  useEffect(() => {
    if (title == null) {
      return;
    }

    document.title = title;
  }, [title]);
}
