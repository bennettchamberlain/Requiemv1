import type { ReactNode } from 'react';

import { MemoryHubNav } from './MemoryHubNav';

/** Wraps Memory hub sub-pages with the shared section nav. */
export function MemoryHubShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <MemoryHubNav />
      {children}
    </div>
  );
}
