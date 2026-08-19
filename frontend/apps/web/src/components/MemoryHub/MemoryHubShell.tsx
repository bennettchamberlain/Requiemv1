import type { ReactNode } from 'react';

import { cn } from '@ci/shadcn';
import { useLocation } from 'react-router-dom';

import { DropdownProvider } from '@/components/SearchBox/useDropdown';

import { MemoryEntityTypeNav } from './MemoryEntityTypeNav';
import { MemoryHubNav } from './MemoryHubNav';
import { isMemoryExplorerPath } from './memoryHubSections';

/** Wraps Memory hub sub-pages with the shared section nav. */
export function MemoryHubShell({
  children,
  actions,
  fillHeight = false,
}: {
  children: ReactNode;
  /**
   * Page-level actions (a "New …" button) pinned to the right of the section
   * nav. Lives on the shell rather than in each page body so every Memory
   * surface puts its create affordance in the same place, whichever of the two
   * navs that surface happens to render.
   */
  actions?: ReactNode;
  /** Fill the page content area — only for Events explorer views that split scroll panes. */
  fillHeight?: boolean;
}) {
  const { pathname } = useLocation();
  const isExplorer = isMemoryExplorerPath(pathname);

  const shellClass = cn('flex flex-col gap-2', fillHeight && 'min-h-0 flex-1');

  if (isExplorer) {
    return (
      <div className={shellClass}>
        <DropdownProvider args={[{ changeSearchParams: true }]}>
          <MemoryEntityTypeNav actions={actions} />
          {children}
        </DropdownProvider>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <MemoryHubNav actions={actions} />
      {children}
    </div>
  );
}
