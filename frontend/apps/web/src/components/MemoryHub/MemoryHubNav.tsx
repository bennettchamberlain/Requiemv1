import type { ReactNode } from 'react';

import { useDeviceLayout } from '@ci/common';
import { cn } from '@ci/shadcn';
import { Link, useLocation } from 'react-router-dom';

import { useFeatures } from '@/common/feature';

import { MEMORY_HUB_SECTIONS } from './memoryHubSections';

export function MemoryHubNav({ actions }: { actions?: ReactNode }) {
  const { pathname } = useLocation();
  const { isMobile } = useDeviceLayout();
  const { isFeatureEnabled } = useFeatures();

  const visible = MEMORY_HUB_SECTIONS.filter((section) => !section.flag || isFeatureEnabled(section.flag));

  // Phone: the Power Rail Memory submenu already lists these destinations.
  // Create lives in the top-bar Add menu, so page actions are omitted.
  if (isMobile) {
    if (!actions) {
      return null;
    }

    return <div className="flex shrink-0 justify-end px-4 pt-2">{actions}</div>;
  }

  return (
    <nav
      aria-label="Memory sections"
      className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-2 md:gap-2 md:px-3"
    >
      <div className="scrollbar-none min-w-0 flex-1 overflow-x-auto overscroll-x-contain md:overflow-visible">
        <div className="flex w-max items-center gap-1 md:w-auto md:flex-wrap md:gap-2">
          {visible.map((section) => {
            const active = section.match(pathname);

            return (
              <Link
                key={section.to}
                to={section.to}
                className={cn(
                  'shrink-0 rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {section.label}
              </Link>
            );
          })}
        </div>
      </div>

      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </nav>
  );
}
