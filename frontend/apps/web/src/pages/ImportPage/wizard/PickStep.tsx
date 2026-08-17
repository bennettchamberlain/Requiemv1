import { useMemo, useState } from 'react';

import { Badge, Button, cn } from '@ci/shadcn';
import { Check } from '@ci/shadcn/icons';

import type { CatalogSource } from '../useImportApi';

import { ECOSYSTEM_ICONS, pickableSections } from './sources';
import { unambiguousImporters, useSourceUsage } from './useSourceUsage';

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
  const [logoFailed, setLogoFailed] = useState<ReadonlySet<string>>(new Set());
  const lastImportedAt = useSourceUsage();
  const ownedImporters = useMemo(() => unambiguousImporters(catalog), [catalog]);

  // No search box and no category chips. Both were answers to a grid of ~100
  // one-line names with nothing to tell them apart; the tiles now carry a logo,
  // a name and what each one imports, and the list is already grouped under the
  // same headings the chips repeated. Scrolling is the navigation.
  const visible = useMemo(() => pickableSections(catalog), [catalog]);

  return (
    // Search and the facet chips stay pinned with the stepper above; only the
    // service grid scrolls. The filter controls are what CAUSE the content
    // swaps, so they must not live in the region whose scrollbar those swaps
    // toggle — and losing the search box off the top of a 100-service list
    // was no good either.
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
        {visible.map((section) => (
          <section key={section.key} className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <span className="h-4 w-4 [&>svg]:h-4 [&>svg]:w-4">{section.icon}</span>
              {section.label}
            </h3>

            {/* Four to a row, matching the connect half's service grid — the
                tiles carry an object list now, not just a name. */}
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {section.items.map((item) => {
                const on = picked.has(item.key);
                const showLogo = item.logo != null && !logoFailed.has(item.key);
                // Newest across the importers this tile covers — and only the
                // ones it owns outright, since a shared parser cannot say WHICH
                // of its services an import came from.
                const imported = item.importers
                  .filter((importer) => ownedImporters.has(importer))
                  .map((importer) => lastImportedAt.get(importer))
                  .filter((at): at is string => at != null)
                  .sort()
                  .at(-1);

                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      aria-pressed={on}
                      title={item.ready ? item.label : `${item.label} — importer coming soon`}
                      onClick={() => onToggle(item.key)}
                      className={cn(
                        'relative flex h-full w-full flex-col gap-3 rounded-md border p-3 text-left text-sm transition-colors',
                        on
                          ? 'border-primary bg-primary/5'
                          : imported
                            ? 'border-green-700/50 bg-green-950/[0.06] dark:border-green-700/45 dark:bg-green-950/40'
                            : 'hover:bg-muted/50',
                        !item.ready && 'opacity-60',
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white p-1.5 ring-1 ring-black/5 text-muted-foreground [&>svg]:h-5 [&>svg]:w-5">
                          {showLogo ? (
                            <img
                              src={item.logo!}
                              alt=""
                              className="h-full w-full object-contain"
                              onError={() => setLogoFailed((previous) => new Set(previous).add(item.key))}
                            />
                          ) : (
                            (ECOSYSTEM_ICONS[item.ecosystem] ?? null)
                          )}
                        </span>

                        <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>

                        {on ? (
                          <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                        ) : imported ? (
                          <Check
                            className="h-4 w-4 shrink-0 text-green-700 dark:text-green-400"
                            aria-hidden
                          />
                        ) : !item.ready ? (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            Coming soon
                          </Badge>
                        ) : null}
                      </span>

                      {item.objects.length > 0 && (
                        <span className="flex flex-col gap-1">
                          {item.objects.map((object) => (
                            <span
                              key={object.label}
                              className="flex items-center gap-2 text-xs text-muted-foreground"
                            >
                              <object.icon aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                              <span className="truncate">{object.label}</span>
                            </span>
                          ))}
                        </span>
                      )}

                      {/* The difference between "I could import this" and "I
                          already did, in March" — which is what stops someone
                          re-importing an archive they have. How MUCH it brought
                          is a fact about the run, and lives on the run. */}
                      {imported && (
                        <span className="mt-auto pt-1 text-xs text-muted-foreground">
                          imported{' '}
                          {new Date(imported).toLocaleDateString(undefined, {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

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
