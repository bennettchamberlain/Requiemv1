import type { ReactNode } from 'react';

import { cn } from '@ci/shadcn';
import { Link, useLocation } from 'react-router-dom';

import { useFeatures } from '@/common/feature';

import { MEMORY_HUB_SECTIONS } from './memoryHubSections';

export function MemoryHubNav({ actions }: { actions?: ReactNode }) {
  const { pathname } = useLocation();
  const { isFeatureEnabled } = useFeatures();

  const visible = MEMORY_HUB_SECTIONS.filter((section) => !section.flag || isFeatureEnabled(section.flag));

  return (
    <nav
      aria-label="Memory sections"
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-2 py-2 md:gap-2 md:px-3"
    >
      {visible.map((section) => {
        const active = section.match(pathname);

        return (
          <Link
            key={section.to}
            to={section.to}
            className={cn(
              'rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {section.label}
          </Link>
        );
      })}

      {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
    </nav>
  );
}
