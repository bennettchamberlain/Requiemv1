import type { ReactNode } from 'react';

import { cn } from '@ci/shadcn';
import { ArrowRight, Cable, MonitorSmartphone, PackageOpen } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import type { SourceCounts } from './useSourceCounts';

export type SourcePath = 'connect' | 'import' | 'devices';

export const SOURCE_PATHS: readonly SourcePath[] = ['connect', 'import', 'devices'];

interface PathDefinition {
  readonly path: SourcePath;
  readonly to: string;
  readonly icon: ReactNode;
  readonly title: string;
  /**
   * The honest trade-off, shown only in the first-run density.
   *
   * There is no summary line above these. A blurb saying "sign in to Google,
   * Microsoft, Spotify and the rest" sat directly on top of a `You get` row
   * saying the same thing in more useful terms; the compact density needs no
   * prose at all, being a switch rather than an explainer.
   */
  readonly effort: string;
  readonly gets: string;
  readonly cta: string;
}

const PATHS: Record<SourcePath, PathDefinition> = {
  connect: {
    path: 'connect',
    to: '/sources/connect',
    icon: <Cable aria-hidden className="h-7 w-7" strokeWidth={1.25} />,
    title: 'Services',
    effort: 'About a minute, once.',
    gets: 'Everything from now on, plus whatever recent history the service hands over.',
    cta: 'Browse services',
  },
  import: {
    path: 'import',
    to: '/sources/import',
    icon: <PackageOpen aria-hidden className="h-7 w-7" strokeWidth={1.25} />,
    title: 'Import',
    effort: 'You request it from the service and wait hours or days, then it takes minutes.',
    gets: 'Your whole history, as far back as the service keeps it.',
    cta: 'Start an import',
  },
  devices: {
    path: 'devices',
    to: '/sources/devices',
    icon: <MonitorSmartphone aria-hidden className="h-7 w-7" strokeWidth={1.25} />,
    title: 'Devices',
    effort: 'Install once, on each browser and machine you use.',
    gets: 'What you read, and what you do on your own computer — neither of which any export contains.',
    cta: 'Add a device',
  },
};

interface Props {
  /** Which path is on screen, so the switch can say so. */
  active: SourcePath;
  counts: SourceCounts;
  /** The paths this appliance actually offers, in order. */
  paths: readonly SourcePath[];
}

/** What this path has to show for itself, as its tile reports it. */
function countFor(path: SourcePath, counts: SourceCounts): { value: number; noun: string } {
  switch (path) {
    case 'connect':
      return { value: counts.connections, noun: 'connected' };
    case 'import':
      return { value: counts.imports, noun: counts.imports === 1 ? 'import' : 'imports' };
    case 'devices':
      return { value: counts.devices, noun: counts.devices === 1 ? 'device' : 'devices' };
  }
}

/**
 * The ways data gets in, as one control.
 *
 * This is both the page's navigation and its empty state, on purpose. A
 * separate first-run screen is a second thing to keep true; here the same tiles
 * simply render louder when there is nothing yet — with what each path is best
 * for, what it costs you, and a button — and quieter once something is flowing,
 * with counts.
 *
 * Three paths, not two. Services and Import are the two halves of "the
 * services I use"; Devices is what you install rather than sign into — the
 * browser extension and Capture, which between them are the only source of
 * what you read and what you do on your own machine. They spent this page's
 * first version as sections below the whole service catalogue, which put the
 * two least substitutable sources behind the longest scroll.
 *
 * The pitch is per path, not per page: a tile makes its case only while THAT
 * path has nothing to show, so someone with services connected and no devices
 * is told what a device would give them and nothing else.
 */
export function SourcePathTiles({ active, counts, paths }: Props) {
  return (
    <section aria-label="Ways to add data" className="w-full">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {paths.map((key) => {
          const count = countFor(key, counts);

          return (
            <PathTile
              key={key}
              definition={PATHS[key]}
              active={active === key}
              // PER PATH, not per page. Someone with three services connected
              // and no devices still needs to be told what a device would give
              // them — and no longer needs to be told what a service would.
              // A page-wide flag showed the pitch for everything or nothing.
              firstRun={!counts.loading && count.value === 0}
              count={count}
            />
          );
        })}
      </div>
    </section>
  );
}

interface PathTileProps {
  definition: PathDefinition;
  active: boolean;
  firstRun: boolean;
  count: { value: number; noun: string };
}

function PathTile({ definition, active, firstRun, count }: PathTileProps) {
  return (
    <Link
      to={definition.to}
      // `page` and not `true`: the tile IS the page you are on, and a screen
      // reader saying "current page" is the same thing the ring says visually.
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex flex-col rounded-lg border bg-card text-left transition',
        'hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary ring-1 ring-primary/40' : 'border-border',
        firstRun ? 'gap-3 p-5' : 'gap-2 p-4',
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex items-center justify-center rounded-md p-2',
            active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {definition.icon}
        </span>
        <span className={cn('font-semibold', firstRun ? 'text-lg' : 'text-base')}>{definition.title}</span>
        {count.value > 0 && (
          <span className="text-muted-foreground ml-auto text-xs font-medium tabular-nums">
            {count.value} {count.noun}
          </span>
        )}
      </div>

      {firstRun && (
        <>
          <dl className="text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground w-20 shrink-0">Effort</dt>
              <dd>{definition.effort}</dd>
            </div>
            <div className="mt-1 flex gap-2">
              <dt className="text-muted-foreground w-20 shrink-0">You get</dt>
              <dd>{definition.gets}</dd>
            </div>
          </dl>

          <span className="text-primary mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium">
            {definition.cta}
            <ArrowRight aria-hidden className="h-4 w-4 transition group-hover:translate-x-0.5" />
          </span>
        </>
      )}
    </Link>
  );
}
