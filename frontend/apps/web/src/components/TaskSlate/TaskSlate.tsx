import { useState } from 'react';

import { Button, cn, Tooltip } from '@ci/shadcn';
import { Clock, GripVertical, Lightbulb, ListTodo, X } from '@ci/shadcn/icons';

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
        'group relative cursor-grab rounded-lg border border-border bg-background p-2.5 pl-7',
        'transition-colors hover:border-primary/50 active:cursor-grabbing',
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

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
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

interface TaskSlateProps {
  candidates: ScheduleCandidate[];
  loading: boolean;
  onDecline: (id: string, reason: DeclineReason) => void;
  onSnooze: (id: string, until: Date) => void;
  className?: string;
}

/**
 * Unplaced suggestions, ranked by fit.
 *
 * Everything here is draggable onto a day; that drag is the only way something
 * becomes committed time. Nothing schedules itself.
 */
export function TaskSlate({ candidates, loading, onDecline, onSnooze, className }: TaskSlateProps) {
  return (
    <div className={cn('flex flex-col rounded-xl border border-border bg-card p-3 md:p-4', className)}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">Possibilities</h3>
        <span className="text-[11px] text-muted-foreground">
          {candidates.length > 0 ? 'drag onto a day' : 'unplaced'}
        </span>
      </div>

      {loading && candidates.length === 0 && (
        <p className="text-[12px] text-muted-foreground">Gathering suggestions…</p>
      )}

      {!loading && candidates.length === 0 && (
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Nothing waiting. Suggestions appear here as your feed and insights turn up things worth doing.
        </p>
      )}

      {/* Grows into whatever height the week grid sets and scrolls inside it,
          so the two panels stay the same box. The cap keeps a long backlog from
          driving the pair taller than the grid instead. */}
      {candidates.length > 0 && (
        <ul className="flex max-h-[32rem] min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
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
  );
}
