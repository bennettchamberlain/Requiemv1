import { useCallback, useState } from 'react';

import { Button, cn, Tooltip } from '@ci/shadcn';
import { Clock, GripVertical, Lightbulb, ListTodo, Loader2, Sparkles, X } from '@ci/shadcn/icons';

import type { DeclineReason, ScheduleCandidate } from '@/api/useScheduleCandidates';

/** MIME-ish key for the drag payload. Kept here so the grid can read the same one. */
export const CANDIDATE_DRAG_TYPE = 'application/x-ci-candidate';

const SOURCE_LABEL: Record<string, string> = {
  action: 'action',
  insight: 'insight',
  summary: 'summary',
  answer: 'you said',
  item: 'inventory',
  relationship: 'people',
  due: 'coming due',
};

/** A day, for the "not now" default. */
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function SourceIcon({ kind }: { kind: string }) {
  const Icon = kind === 'insight' ? Lightbulb : ListTodo;

  return <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden />;
}

interface CardProps {
  candidate: ScheduleCandidate;
  onDecline: (id: string, reason: DeclineReason) => void;
  onSnooze: (id: string, until: Date) => void;
}

function CandidateCard({ candidate, onDecline, onSnooze }: CardProps) {
  const [expanded, setExpanded] = useState(false);
  const kind = candidate.rationaleSources[0]?.kind ?? 'action';

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CANDIDATE_DRAG_TYPE, candidate.id);
        // Plain text too, so a drop outside the app degrades to the title
        // rather than to an opaque id.
        e.dataTransfer.setData('text/plain', candidate.title);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        // A fixed-width tile in the rail: cards must be uniform for the row to
        // scan, and `shrink-0` is what keeps them from compressing to slivers
        // as the backlog grows.
        'group relative flex w-60 shrink-0 flex-col rounded-lg border border-border bg-background',
        'cursor-grab p-2.5 pl-7 transition-colors hover:border-primary/50 active:cursor-grabbing',
      )}
    >
      <GripVertical
        className="absolute left-1.5 top-3 h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground"
        strokeWidth={1.5}
        aria-hidden
      />

      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[13px] leading-snug text-foreground">{candidate.title}</p>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Tooltip>
            <Tooltip.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label={`Snooze ${candidate.title}`}
                onClick={() => onSnooze(candidate.id, new Date(Date.now() + SNOOZE_MS))}
              >
                <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side="top">Not today</Tooltip.Content>
          </Tooltip>

          <Tooltip>
            <Tooltip.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                aria-label={`Dismiss ${candidate.title}`}
                onClick={() => onDecline(candidate.id, 'never')}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content side="top">Never suggest this</Tooltip.Content>
          </Tooltip>
        </div>
      </div>

      {/* The because. Nothing on this list appears without one. */}
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="mt-1.5 flex w-full items-start gap-1.5 text-left text-[11px] text-muted-foreground hover:text-foreground/80"
      >
        <SourceIcon kind={kind} />
        <span className={cn('flex-1', expanded ? '' : 'line-clamp-2')}>{candidate.rationale}</span>
      </button>

      {/* Pushed to the card's foot so the tag strip lines up across the rail
          even when one card's rationale runs longer than its neighbour's. */}
      <div className="mt-auto flex flex-wrap items-center gap-1 pt-1.5">
        {candidate.rationaleSources.slice(0, 3).map((source) => (
          <span
            key={`${source.kind}-${source.id}`}
            className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground"
          >
            {SOURCE_LABEL[source.kind] ?? source.kind}
          </span>
        ))}
        {candidate.durationMinutes && (
          <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground tabular-nums">
            {candidate.durationMinutes}m
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * Free-text in, cards out.
 *
 * Notes go in the way you'd say them ("dentist, prep Thursday's deck, call Mum
 * back") and come back as separate draggable cards. It is a way to GET things
 * onto the slate, not onto the calendar — the split is the only thing being
 * automated, and placing a card is still a drag.
 *
 * The box keeps its text until something actually lands, so a failed or empty
 * generation never eats what you typed.
 */
function BrainDump({ onSubmit }: { onSubmit: (text: string) => Promise<number> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const submit = useCallback(async () => {
    const trimmed = text.trim();

    if (trimmed.length === 0 || busy) {
      return;
    }

    setBusy(true);
    setNote(null);

    try {
      const added = await onSubmit(trimmed);

      if (added > 0) {
        setText('');
        setNote(`Added ${added} ${added === 1 ? 'card' : 'cards'}.`);
      } else {
        setNote('Nothing came back — try naming the tasks more plainly.');
      }
    } catch {
      setNote('Could not break that down. Try again shortly.');
    } finally {
      setBusy(false);
    }
  }, [text, busy, onSubmit]);

  return (
    // Fixed-width and first in the row, so it stays put while the cards scroll
    // past it — the place you type should not move.
    <div className="flex w-full shrink-0 flex-col sm:w-72">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter submits, Shift+Enter breaks the line: a brain dump is usually
          // one line, and reaching for a button breaks the flow of typing.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={2}
        disabled={busy}
        aria-label="What do you need to do?"
        placeholder="What do you need to do? Type it however it comes out…"
        className={cn(
          'w-full flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-2',
          'text-[13px] leading-snug text-foreground placeholder:text-muted-foreground/70',
          'focus:border-primary/60 focus:outline-none disabled:opacity-60',
        )}
      />

      <div className="mt-1.5 flex min-h-6 items-center gap-2">
        <Button
          size="sm"
          className="h-6 shrink-0 text-xs"
          disabled={busy || text.trim().length === 0}
          onClick={() => void submit()}
        >
          {busy ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
          ) : (
            <Sparkles className="mr-1 h-3.5 w-3.5" strokeWidth={1.5} />
          )}
          {busy ? 'Splitting…' : 'Break into tasks'}
        </Button>

        {note && <span className="text-[11px] leading-tight text-muted-foreground">{note}</span>}
      </div>
    </div>
  );
}

interface TaskSlateProps {
  candidates: ScheduleCandidate[];
  loading: boolean;
  onDecline: (id: string, reason: DeclineReason) => void;
  onSnooze: (id: string, until: Date) => void;
  /** Omit to hide the brain-dump box (the read-only stories do). */
  onBreakDown?: (text: string) => Promise<number>;
  className?: string;
}

/**
 * Unplaced suggestions, ranked by fit — a rail across the top of the week.
 *
 * Laid out as a row rather than a column because it sits above a full-width
 * grid: a tall column of cards beside the week squeezed both, and the days are
 * what the page is actually about. As a rail it stays one card deep, the week
 * gets the whole width, and every card is still a short drag from its day.
 *
 * Everything here is draggable onto a day; that drag is the only way something
 * becomes committed time. Nothing schedules itself.
 */
export function TaskSlate({
  candidates,
  loading,
  onDecline,
  onSnooze,
  onBreakDown,
  className,
}: TaskSlateProps) {
  const hasCards = candidates.length > 0;

  return (
    <div className={cn('rounded-xl border border-border bg-card p-3 md:p-4', className)}>
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">Possibilities</h3>
        <span className="text-[11px] text-muted-foreground">
          {hasCards ? 'drag one onto a day below' : 'unplaced'}
        </span>
      </div>

      {/* The compose box holds the left edge; the cards scroll horizontally past
          it. `items-stretch` is what makes a short card match a tall one, so the
          rail reads as one band rather than a ragged edge. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        {onBreakDown && <BrainDump onSubmit={onBreakDown} />}

        {loading && !hasCards && (
          <p className="self-center text-[12px] text-muted-foreground">Gathering suggestions…</p>
        )}

        {!loading && !hasCards && (
          <p className="max-w-md self-center text-[12px] leading-relaxed text-muted-foreground">
            Nothing waiting yet. Type what you need to do, or wait for your feed and insights to turn
            something up.
          </p>
        )}

        {hasCards && (
          // Negative margin + padding so a card's focus ring and hover border
          // are not clipped by the scroll container's own edge.
          <ul className="-my-1 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1">
            {candidates.map((candidate) => (
              <CandidateCard
                key={candidate.id}
                candidate={candidate}
                onDecline={onDecline}
                onSnooze={onSnooze}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
