import { useMemo, useState } from 'react';

import { Badge, Button, Input, cn } from '@ci/shadcn';
import { Check, Search } from '@ci/shadcn/icons';

import type { CatalogSource } from '../useImportApi';

import { ECOSYSTEM_ICONS, pickableSections, type PickItem } from './sources';

export interface PickStepProps {
  catalog: readonly CatalogSource[];
  picked: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onContinue: () => void;
}

/**
 * Step 1: which ecosystems do you use?
 *
 * A grid of recognizable brands grouped into sections, because the person
 * answering has never heard of an "importer" — they know they use Spotify. A
 * source whose parser is not written yet is still shown, badged "coming soon"
 * and sorted last: "we know this service and haven't finished it" is a
 * materially different answer from silence, which reads as unsupported.
 */
export function PickStep({ catalog, picked, onToggle, onContinue }: PickStepProps) {
  const [query, setQuery] = useState('');
  const [facet, setFacet] = useState('all');
  const [logoFailed, setLogoFailed] = useState<ReadonlySet<string>>(new Set());

  const sections = useMemo(() => pickableSections(catalog), [catalog]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (item: PickItem) =>
      !needle || item.label.toLowerCase().includes(needle) || item.key.toLowerCase().includes(needle);

    return sections
      .filter((section) => facet === 'all' || section.key === facet)
      .map((section) => ({ ...section, items: section.items.filter(matches) }))
      .filter((section) => section.items.length > 0);
  }, [facet, query, sections]);

  return (
    // Search and the facet chips stay pinned with the stepper above; only the
    // service grid scrolls. The filter controls are what CAUSE the content
    // swaps, so they must not live in the region whose scrollbar those swaps
    // toggle — and losing the search box off the top of a 100-service list
    // was no good either.
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="relative max-w-md shrink-0">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          className="pl-9"
          placeholder="Search services…"
          aria-label="Search services"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className="flex shrink-0 flex-wrap gap-1.5" role="group" aria-label="Filter by category">
        <FacetChip active={facet === 'all'} onClick={() => setFacet('all')}>
          All
        </FacetChip>
        {sections.map((section) => (
          <FacetChip
            key={section.key}
            active={facet === section.key}
            onClick={() => setFacet((current) => (current === section.key ? 'all' : section.key))}
          >
            {section.label}
          </FacetChip>
        ))}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        {visible.map((section) => (
          <section key={section.key} className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span className="h-4 w-4 [&>svg]:h-4 [&>svg]:w-4">{section.icon}</span>
              {section.label}
            </h3>

            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {section.items.map((item) => {
                const on = picked.has(item.key);
                const showLogo = item.logo != null && !logoFailed.has(item.key);

                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      aria-pressed={on}
                      title={item.ready ? item.label : `${item.label} — importer coming soon`}
                      onClick={() => onToggle(item.key)}
                      className={cn(
                        'relative flex w-full items-center gap-2 rounded-md border p-2.5 text-left text-sm transition-colors',
                        on ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
                        !item.ready && 'opacity-60',
                      )}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground [&>svg]:h-5 [&>svg]:w-5">
                        {showLogo ? (
                          <img
                            src={item.logo!}
                            alt=""
                            className="h-6 w-6 object-contain"
                            onError={() => setLogoFailed((previous) => new Set(previous).add(item.key))}
                          />
                        ) : (
                          (ECOSYSTEM_ICONS[item.ecosystem] ?? null)
                        )}
                      </span>

                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                        {!item.ready && (
                          <Badge variant="outline" className="ml-1.5 text-[10px]">
                            Coming soon
                          </Badge>
                        )}
                      </span>

                      {on && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {catalog.length > 0 && visible.length === 0 && (
          <div className="space-y-2 rounded-md border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              No services match. Try a different search, or clear the category filter.
            </p>
            <Button
              variant="ghost"
              onClick={() => {
                setQuery('');
                setFacet('all');
              }}
            >
              Clear search
            </Button>
          </div>
        )}

        {catalog.length === 0 && <p className="text-sm text-muted-foreground">Loading services…</p>}
      </div>

      {/* OUTSIDE the scroll region, deliberately.

          The service list is ~100 entries — 2,300px against a 290px viewport
          when this surface is embedded in onboarding. With the button at the
          end of that list, you picked a service at the top and the control
          that acts on your pick was two thousand pixels below the fold, while
          onboarding's own "Next" sat permanently visible directly beneath the
          surface and did the opposite thing: skip the step. Two buttons, and
          the reachable one was wrong.

          Pinned, it is always the nearest control to the choice being made. */}
      <div className="flex shrink-0 justify-end border-t pt-4">
        <Button disabled={picked.size === 0} onClick={onContinue}>
          Continue → {picked.size} selected
        </Button>
      </div>
    </div>
  );
}

function FacetChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-xs transition-colors',
        active ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50',
      )}
    >
      {children}
    </button>
  );
}
