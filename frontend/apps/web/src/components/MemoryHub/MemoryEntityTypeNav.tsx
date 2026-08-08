import { cn } from '@ci/shadcn';
import { useSearchParams } from 'react-router-dom';

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
      aria-label="Memory entity types"
      className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2 md:gap-1.5 md:px-4"
    >
      {AVAILABLE_ENTITY_TYPES.map((entityType) => {
        const active = allSelected || selectedEntityTypes.includes(entityType);
        const primary = isFiltered && selectedEntityTypes.includes(entityType);
        const label = ENTITY_TYPE_LABELS[entityType] ?? entityType;

        return (
          <button
            key={entityType}
            type="button"
            aria-pressed={active}
            onClick={() => selectOnlyEntityType(entityType)}
            className={cn(
              'rounded-md px-2.5 py-1 text-sm font-medium transition-colors',
              primary
                ? 'bg-primary text-primary-foreground shadow-sm'
                : active
                  ? 'text-foreground hover:bg-accent'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
