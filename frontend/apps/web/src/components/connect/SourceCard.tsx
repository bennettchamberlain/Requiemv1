import type { ComponentType, ReactNode } from 'react';

import { cn } from '@ci/shadcn';
import { Check } from '@ci/shadcn/icons';

/** One kind of thing a source hands over, as the card lists it. */
export interface TrackedObject {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
}

export interface SourceCardProps {
  /** Brand mark. Rendered on a white chip — see the note in the component. */
  logo?: string;
  /** Stands in for `logo` on a source with no brand image of its own. */
  icon?: ReactNode;
  /** The source, as someone would say it out loud. */
  name: string;
  /** What adding it actually puts in your memory. */
  tracks: readonly TrackedObject[];
  /** Recognised but not implemented — inert, and says why. */
  comingSoon?: boolean;
  /** Already added, and this host allows only one (onboarding). */
  locked?: boolean;
  /** Active connections, when the source has any. */
  count?: number;
  /**
   * Records this source has actually put in the memory, across every
   * connection and import. Omitted (or 0) hides the line.
   */
  records?: number;
  /** ISO timestamp of the last successful sync or import, when there was one. */
  lastActivityAt?: string | null;
  /** What the last activity was, so the line can name it honestly. */
  activityVerb?: 'synced' | 'imported';
  onSelect?: () => void;
}

/** "3 minutes ago", "yesterday", "12 Mar" — precision nobody has to parse. */
function relativeDay(iso: string): string | null {
  const then = new Date(iso);

  if (Number.isNaN(then.getTime())) {
    return null;
  }

  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);

  if (days <= 0) {
    return 'today';
  }

  if (days === 1) {
    return 'yesterday';
  }

  if (days < 30) {
    return `${days} days ago`;
  }

  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * One source, as a name and the things it hands over.
 *
 * Every one of these used to be a full-bleed brand-coloured panel with a
 * sentence of marketing under it ("Link your Google account for Gmail,
 * Calendar, Drive, Photos, and YouTube") — three to a row, roughly a screen per
 * six services, and the answer to "what do I actually get" buried in prose you
 * had to read end-to-end to compare any two. A named list of objects is the
 * same information made scannable: four to a row, in the same position on
 * every card, comparable down a column.
 *
 * A button, not a div with a click handler: these start OAuth flows and
 * downloads, so they should be reachable by keyboard, announce themselves, and
 * go genuinely inert when disabled rather than merely looking it.
 *
 * The logo keeps a white chip behind it. The brand marks are authored for a
 * light ground — GitHub's, X's and Notion's are solid black — so dropping them
 * onto a themed surface makes three of them vanish in dark mode.
 */
export function SourceCard({
  logo,
  icon,
  name,
  tracks,
  comingSoon = false,
  locked = false,
  count = 0,
  records = 0,
  lastActivityAt,
  activityVerb = 'synced',
  onSelect,
}: SourceCardProps) {
  const isConnected = count > 0;
  const disabled = comingSoon || locked;
  const lastActivity = lastActivityAt ? relativeDay(lastActivityAt) : null;
  // "In use" is a broader claim than "connected": an archive import leaves no
  // connection behind, and a source that gave you a decade of history should
  // not read as untouched next to one you signed into a minute ago.
  const inUse = isConnected || records > 0 || lastActivity != null;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'group flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled
          ? 'cursor-not-allowed opacity-60'
          : 'cursor-pointer hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md',
        inUse
          ? 'border-green-700/50 bg-green-950/[0.06] dark:border-green-700/45 dark:bg-green-950/40'
          : 'border-border',
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-md p-1.5',
            logo ? 'bg-white ring-1 ring-black/5' : 'bg-muted text-muted-foreground',
          )}
        >
          {logo ? <img src={logo} alt="" className="h-full w-full object-contain" /> : icon}
        </span>
        <span className="truncate font-semibold">{name}</span>

        {inUse ? (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-xs font-medium text-green-700 dark:text-green-400">
            <Check aria-hidden className="h-3.5 w-3.5" />
            {isConnected ? (count === 1 ? 'Connected' : `${count} connected`) : 'In use'}
          </span>
        ) : comingSoon ? (
          <span className="text-muted-foreground ml-auto shrink-0 text-xs font-medium">Coming soon</span>
        ) : null}
      </div>

      <ul className="space-y-1">
        {tracks.map((tracked) => (
          <li key={tracked.label} className="text-muted-foreground flex items-center gap-2 text-sm">
            <tracked.icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.5} />
            <span className="truncate">{tracked.label}</span>
          </li>
        ))}
      </ul>

      {/* What this source has actually done, once it has done something. Two
          facts, because they answer different worries: how much of my life is
          in here, and is it still keeping up. */}
      {(records > 0 || lastActivity) && (
        <span className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-1 text-xs text-muted-foreground">
          {records > 0 && (
            <span>
              {records.toLocaleString()} {records === 1 ? 'record' : 'records'}
            </span>
          )}
          {records > 0 && lastActivity && <span aria-hidden>·</span>}
          {lastActivity && (
            <span>
              {activityVerb} {lastActivity}
            </span>
          )}
        </span>
      )}
    </button>
  );
}
