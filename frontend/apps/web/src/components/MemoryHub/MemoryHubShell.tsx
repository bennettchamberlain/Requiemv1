import type { ReactNode } from 'react';

import { cn } from '@ci/shadcn';
import { useLocation } from 'react-router-dom';

import { DropdownProvider } from '@/components/SearchBox/useDropdown';

import { MemoryEntityTypeNav } from './MemoryEntityTypeNav';
import { MemoryHubNav } from './MemoryHubNav';

/** Wraps Memory hub sub-pages with the shared section nav. */
export function MemoryHubShell({
  children,
  fillHeight = false,
}: {
  children: ReactNode;
  /** Fill the page content area — only for Events explorer views that split scroll panes. */
  fillHeight?: boolean;
}) {
  const { pathname } = useLocation();
  const isExplorer = pathname === '/memory';

  const shellClass = cn('flex flex-col gap-2', fillHeight && 'min-h-0 flex-1');

  if (isExplorer) {
    return (
      <div className={shellClass}>
        <DropdownProvider args={[{ changeSearchParams: true }]}>
          <MemoryEntityTypeNav />
          {children}
        </DropdownProvider>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <MemoryHubNav />
      {children}
    </div>
  );
}
