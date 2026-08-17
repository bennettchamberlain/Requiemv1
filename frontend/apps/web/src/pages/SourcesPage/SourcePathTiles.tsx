import type { ReactNode } from 'react';

import { cn } from '@ci/shadcn';
import { ArrowRight, Cable, PackageOpen } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import type { SourceCounts } from './useSourceCounts';

export type SourcePath = 'connect' | 'import';

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
    title: 'Connect a service',
    effort: 'About a minute, once.',
    gets: 'Everything from now on, plus whatever recent history the service hands over.',
    cta: 'Browse services',
  },
  import: {
    path: 'import',
    to: '/sources/import',
    icon: <PackageOpen aria-hidden className="h-7 w-7" strokeWidth={1.25} />,
    title: 'Import an export',
    effort: 'You request it from the service and wait hours or days, then it takes minutes.',
    gets: 'Your whole history, as far back as the service keeps it.',
    cta: 'Start an import',
  },
};

interface Props {
  /** Which half is on screen, so the switch can say so. */
  active: SourcePath;
  counts: SourceCounts;
  /** Hidden entirely when the appliance has importing turned off. */
  importEnabled: boolean;
}

/**
 * The two ways data gets in, as one control.
 *
 * This is both the page's navigation and its empty state, on purpose. A
 * separate first-run screen is a second thing to keep true; here the same two
 * tiles simply render louder when there is nothing yet — with what each path is
 * best for, what it costs you, and a button — and quieter once something is
 * flowing, with counts.
 *
 * The distinction the first-run copy draws is the one people actually get
 * wrong: connecting is cheap and forward-looking, an export is slow and
 * backward-looking, and most people want both. Saying that here is the whole
 * job of the screen a new user lands on.
 */
export function SourcePathTiles({ active, counts, importEnabled }: Props) {
  // With importing turned off there is only one path, and a switch with one
  // position is furniture. The half below is the page.
  if (!importEnabled) {
    return null;
  }

  const firstRun = counts.isFirstRun;

  // No heading above the tiles, first run or not. A line saying "there are two
  // ways in" sits directly on top of two tiles that show exactly that, and on
  // an empty appliance it was the third restatement of the page's own name.
  // The tiles carry the guidance themselves.
  return (
    <section aria-label="Ways to add data" className="w-full">
      <div className={cn('grid gap-4', firstRun ? 'md:grid-cols-2' : 'sm:grid-cols-2')}>
        {(['connect', 'import'] as const).map((key) => (
          <PathTile
            key={key}
            definition={PATHS[key]}
            active={active === key}
            firstRun={firstRun}
            count={key === 'connect' ? counts.connections : counts.imports}
          />
        ))}
      </div>
    </section>
  );
}

interface PathTileProps {
  definition: PathDefinition;
  active: boolean;
  firstRun: boolean;
  count: number;
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
        {!firstRun && count > 0 && (
          <span className="text-muted-foreground ml-auto text-xs font-medium tabular-nums">
            {definition.path === 'connect'
              ? `${count} connected`
              : `${count} ${count === 1 ? 'import' : 'imports'}`}
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
