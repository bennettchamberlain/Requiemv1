import type { ComponentType } from 'react';

import { cn } from '@ci/shadcn';
import { Shapes } from '@ci/shadcn/icons';
import { useSearchParams } from 'react-router-dom';

import {
  BrowserActivityIcon,
  CommunicationIcon,
  ContentIcon,
  EventIcon,
  FileIcon,
  ItemIcon,
  NoteIcon,
  PersonIcon,
  PlaceIcon,
} from '@/components/icons';
import { AVAILABLE_ENTITY_TYPES, useDropdown } from '@/components/SearchBox/useDropdown';

const ENTITY_TYPE_LABELS: Record<string, string> = {
  Browser: 'Browser',
  Communication: 'Communication',
  Content: 'Content',
  Event: 'Events',
  File: 'Files',
  Note: 'Notes',
  Person: 'People',
  Place: 'Places',
  Thing: 'Things',
};

const ENTITY_TYPE_ICONS: Record<string, ComponentType<{ className?: string; colorized?: boolean }>> = {
  Browser: BrowserActivityIcon,
  Communication: CommunicationIcon,
  Content: ContentIcon,
  Event: EventIcon,
  File: FileIcon,
  Note: NoteIcon,
  Person: PersonIcon,
  Place: PlaceIcon,
  Thing: ItemIcon,
};

/** Entity-type toggles for the Memory explorer — replaces the old What dropdown. */
export function MemoryEntityTypeNav() {
  const [searchParams] = useSearchParams();
  const [{ selectedEntityTypes }, { selectOnlyEntityType }] = useDropdown();

  const includedOnly = searchParams.get('includedEntityTypes');
  const excludedOnly = searchParams.get('excludedEntityTypes');
  const isFiltered = Boolean(includedOnly || excludedOnly);
  const allSelected = selectedEntityTypes.length === AVAILABLE_ENTITY_TYPES.length;

  return (
    <nav
      aria-label="What to show in Memory"
      className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 md:gap-3 md:px-4"
    >
      <div className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Shapes className="h-4 w-4" strokeWidth={1.5} aria-hidden />
        <span>What</span>
      </div>

      <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain">
        <div className="flex w-max items-center gap-1.5 pb-0.5 md:gap-2">
          {AVAILABLE_ENTITY_TYPES.map((entityType) => {
            const active = allSelected || selectedEntityTypes.includes(entityType);
            const selected = isFiltered && selectedEntityTypes.includes(entityType);
            const label = ENTITY_TYPE_LABELS[entityType] ?? entityType;
            const Icon = ENTITY_TYPE_ICONS[entityType];

            return (
              <button
                key={entityType}
                type="button"
                aria-pressed={active}
                onClick={() => selectOnlyEntityType(entityType)}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-medium transition-colors',
                  selected
                    ? 'border-primary bg-background text-foreground shadow-sm'
                    : active
                      ? 'border-border bg-background text-foreground hover:bg-accent'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                <span className="whitespace-nowrap">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
