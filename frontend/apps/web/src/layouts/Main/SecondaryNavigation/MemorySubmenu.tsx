import { useState } from 'react';

import { Collapsible, Tooltip, cn } from '@ci/shadcn';
import { Brain, ChevronRight } from '@ci/shadcn/icons';
import { Link, useLocation } from 'react-router-dom';

import { useFeatures } from '@/common/feature';
import {
  MEMORY_HUB_SECTIONS,
  isMemoryHubPath,
} from '@/components/MemoryHub/memoryHubSections';

import { usePowerRail } from '../PowerRailContext';

/**
 * Power Rail Memory entry with hub section children.
 *
 * Open state is sticky after an explicit click, otherwise transient from hover
 * or being on a Memory hub route (closes when leaving those routes if it was
 * never click-stuck open).
 */
export function MemorySubmenu() {
  const { expanded } = usePowerRail();
  const { pathname } = useLocation();
  const { isFeatureEnabled } = useFeatures();
  const [stickyOpen, setStickyOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);

  const routeOpen = isMemoryHubPath(pathname);
  const open = stickyOpen || routeOpen || hoverOpen;
  const parentActive = routeOpen;

  const visible = MEMORY_HUB_SECTIONS.filter((section) => !section.flag || isFeatureEnabled(section.flag));

  if (!expanded) {
    const collapsed = (
      <Link
        to="/memory/events"
        aria-label="Memory"
        className={cn(
          'relative rounded-md border-l-2 border-transparent p-2 transition will-change-transform hover:bg-accent hover:text-accent-foreground active:scale-95',
          parentActive && 'border-l-primary text-primary hover:text-primary dark:shadow-glow-ci',
        )}
      >
        <Brain className="h-6 w-6 shrink-0" strokeWidth={1.25} />
      </Link>
    );

    return (
      <Tooltip>
        <Tooltip.Trigger asChild>{collapsed}</Tooltip.Trigger>
        <Tooltip.Content side="right">Memory</Tooltip.Content>
      </Tooltip>
    );
  }

  return (
    <div onMouseEnter={() => setHoverOpen(true)} onMouseLeave={() => setHoverOpen(false)}>
      <Collapsible
        open={open}
        onOpenChange={(next) => {
          // Chevron / trigger: pin open on open; unpin sticky on close (route
          // or hover may still keep the panel visible).
          setStickyOpen(next);
        }}
      >
        <div
          className={cn(
            'flex w-full items-center gap-1 rounded-md border-l-2 border-transparent transition',
            parentActive && 'border-l-primary text-primary dark:shadow-glow-ci',
          )}
        >
          <Link
            to="/memory/events"
            aria-label="Memory"
            onClick={() => setStickyOpen(true)}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 transition hover:bg-accent hover:text-accent-foreground',
              parentActive && 'hover:text-primary',
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center">
              <Brain className="h-6 w-6" strokeWidth={1.25} />
            </span>
            <span className="truncate text-sm">Memory</span>
          </Link>
          <Collapsible.Trigger
            className="rounded-md p-2 transition hover:bg-accent hover:text-accent-foreground [&[data-state=open]>svg]:rotate-90"
            aria-label={open ? 'Collapse Memory sections' : 'Expand Memory sections'}
          >
            <ChevronRight className="h-4 w-4 shrink-0 transition-transform" />
          </Collapsible.Trigger>
        </div>

        <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
          <div className="flex flex-col gap-0.5 py-0.5">
            {visible.map((section) => {
              const Icon = section.icon;
              const active = section.match(pathname);

              return (
                <Link
                  key={section.to}
                  to={section.to}
                  aria-label={section.label}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-md border-l-2 border-transparent px-2 py-0.5 text-sm transition hover:bg-accent hover:text-accent-foreground',
                    active && 'border-l-primary text-primary hover:text-primary dark:shadow-glow-ci',
                  )}
                >
                  <span className="grid size-8 shrink-0 place-items-center" aria-hidden>
                    <Icon className="h-4 w-4" colorized={false} />
                  </span>
                  <span className="truncate">{section.label}</span>
                </Link>
              );
            })}
          </div>
        </Collapsible.Content>
      </Collapsible>
    </div>
  );
}
