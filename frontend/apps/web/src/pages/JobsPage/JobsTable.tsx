import { useState } from 'react';

import { Badge, Button, Card, Input, Skeleton } from '@ci/shadcn';
import { AlertTriangle, ChevronDown, ChevronRight } from '@ci/shadcn/icons';

import { COMPACT_CARD } from './layout';
import type { JobFilters, JobListItem, JobListResponse } from './useJobsList';

type Props = {
  data: JobListResponse | null;
  loading: boolean;
  error: string | null;
  filters: JobFilters;
  categories: readonly string[];
  onChange: (next: Partial<JobFilters>) => void;
};

/**
 * The state tabs.
 *
 * `dead-letter` is not a pg-boss state — dead-lettered jobs are stored as
 * `created` on the dead-letter queue, which is exactly why they used to be
 * counted as pending work. It gets its own tab because "gave up" is the state an
 * operator actually cares about, whatever the column says.
 */
const STATE_TABS = [
  { key: '', label: 'All' },
  { key: 'created', label: 'Waiting' },
  { key: 'active', label: 'Running' },
  { key: 'retry', label: 'Retrying' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'dead-letter', label: 'Dead-lettered' },
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  search: 'Search index',
  ingest: 'Ingest',
  enrich: 'Enrichment',
  graph: 'Life graph',
  pipeline: 'Pipeline',
  import: 'Import / sync',
  llm: 'Model',
  personalization: 'Personalization',
  maintenance: 'Maintenance',
};

/**
 * One table for every job, with the filters that make it navigable.
 *
 * This replaces five fixed card columns that each showed 25 rows selected by
 * the server with no way to change them — so the answer to "why did that job
 * fail?" was "it is probably not one of these 125". Everything here is a server
 * query: filtering and paging over `pgboss.job` cannot be done in the browser
 * when the table routinely holds tens of thousands of rows.
 */
export function JobsTable({ data, loading, error, filters, categories, onChange }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const from = total === 0 ? 0 : filters.offset + 1;
  const to = Math.min(filters.offset + filters.limit, total);

  // Every state bucket added up — what "All" means under the non-state filters.
  const allStatesTotal = Object.values(data?.stateCounts ?? {}).reduce((sum, count) => sum + count, 0);

  return (
    <Card className={COMPACT_CARD}>
      <Card.Header className="gap-2.5">
        <div className="flex flex-col gap-1">
          <Card.Title className="text-base">Jobs</Card.Title>
          <Card.Description>
            {loading && !data
              ? 'Loading…'
              : total === 0
                ? 'No jobs match these filters.'
                : `${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()}`}
          </Card.Description>
        </div>

        {/* State tabs carry their own counts, so picking one is an informed
            choice rather than a guess. Counts ignore the state filter itself. */}
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Job state">
          {STATE_TABS.map((tab) => {
            // `stateCounts` deliberately ignores the state filter, so every tab
            // shows what picking it would yield. `total` does NOT — it reflects
            // the active filter — so using it for "All" made the All tab count
            // collapse to the current selection the moment one was made.
            const count = tab.key ? data?.stateCounts?.[tab.key] : allStatesTotal;

            return (
              <Button
                key={tab.key || 'all'}
                role="tab"
                aria-selected={filters.state === tab.key}
                size="sm"
                variant={filters.state === tab.key ? 'secondary' : 'ghost'}
                onClick={() => onChange({ state: tab.key, offset: 0 })}
              >
                {tab.label}
                {count != null ? (
                  <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                    {count.toLocaleString()}
                  </span>
                ) : null}
              </Button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <Input
            value={filters.search}
            onChange={(event) => onChange({ search: event.target.value, offset: 0 })}
            placeholder="Search event, queue or error message…"
            aria-label="Search jobs"
            className="md:max-w-xs"
          />
          <FilterSelect
            label="Category"
            value={filters.category}
            options={categories.map((category) => ({
              value: category,
              label: CATEGORY_LABELS[category] ?? category,
            }))}
            onChange={(category) => onChange({ category, offset: 0 })}
          />
          <FilterSelect
            label="Queue"
            value={filters.queue}
            options={(data?.queues ?? []).map((queue) => ({ value: queue, label: queue }))}
            onChange={(queue) => onChange({ queue, offset: 0 })}
          />
          {(filters.state || filters.queue || filters.category || filters.search) && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onChange({ state: '', queue: '', category: '', search: '', offset: 0 })}
            >
              Clear
            </Button>
          )}
        </div>
      </Card.Header>

      <Card.Content className="space-y-2">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {loading && !data ? (
          <Skeleton className="h-[400px] w-full" />
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Nothing matches these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs uppercase text-muted-foreground">
                  <th scope="col" className="w-8 py-1.5" />
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Job
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    Queue
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    State
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                    Duration
                  </th>
                  <th scope="col" className="py-1.5 pr-3 text-right font-medium">
                    Retries
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((job) => (
                  <JobRow
                    key={job.id}
                    job={job}
                    expanded={expanded === job.id}
                    onToggle={() => setExpanded((current) => (current === job.id ? null : job.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            disabled={filters.offset === 0}
            onClick={() => onChange({ offset: Math.max(filters.offset - filters.limit, 0) })}
          >
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {Math.floor(filters.offset / filters.limit) + 1} of{' '}
            {Math.max(Math.ceil(total / filters.limit), 1)}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={filters.offset + filters.limit >= total}
            onClick={() => onChange({ offset: filters.offset + filters.limit })}
          >
            Next
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}

function JobRow({ job, expanded, onToggle }: { job: JobListItem; expanded: boolean; onToggle: () => void }) {
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <>
      <tr className="cursor-pointer border-b border-border/40 align-top hover:bg-muted/40" onClick={onToggle}>
        <td className="py-1.5">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`Details for ${job.label}`}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
          >
            <Chevron className="h-4 w-4" />
          </button>
        </td>
        <td className="py-1.5 pr-3">
          <div className="flex flex-col">
            <span className="font-medium">{job.label}</span>
            <span className="text-xs text-muted-foreground">
              {job.event ?? 'no event name'}
              {job.interactive ? ' · interactive' : ''}
            </span>
          </div>
          {job.failure ? (
            <span className="mt-1 inline-flex max-w-full items-center gap-1 text-xs text-destructive">
              <AlertTriangle aria-hidden className="h-3 w-3 shrink-0" />
              <span className="truncate" title={job.failure.message}>
                {job.failure.message}
              </span>
            </span>
          ) : null}
        </td>
        <td className="py-1.5 pr-3 text-xs text-muted-foreground">{job.queue}</td>
        <td className="py-1.5 pr-3">
          <StateBadge job={job} />
        </td>
        <td className="py-1.5 pr-3 text-right tabular-nums text-xs text-muted-foreground">
          {formatDuration(job.durationMs)}
        </td>
        <td className="py-1.5 pr-3 text-right tabular-nums text-xs text-muted-foreground">
          {job.retryCount}/{job.retryLimit}
        </td>
        <td className="py-1.5 text-right text-xs text-muted-foreground">{formatTimestamp(job.createdOn)}</td>
      </tr>
      {expanded ? (
        <tr className="border-b border-border/40 bg-muted/20">
          <td />
          <td colSpan={6} className="py-2 pr-3">
            <p className="mb-2 max-w-3xl text-xs text-muted-foreground">{job.description}</p>
            <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Job id" value={job.id} mono />
              <Detail label="Category" value={CATEGORY_LABELS[job.category] ?? job.category} />
              <Detail label="Payload" value={`${job.payloadBytes.toLocaleString()} bytes`} />
              <Detail label="Started" value={formatTimestamp(job.startedOn)} />
              <Detail label="Completed" value={formatTimestamp(job.completedOn)} />
              {job.workType ? <Detail label="Work type" value={job.workType} /> : null}
            </dl>
            {job.failure ? (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-2">
                <p className="text-xs font-medium text-destructive">{job.failure.message}</p>
                {job.failure.failedAt ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Failed {formatTimestamp(job.failure.failedAt)}
                  </p>
                ) : null}
                {job.failure.stack ? (
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2 text-[11px] leading-snug text-muted-foreground">
                    {job.failure.stack}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StateBadge({ job }: { job: JobListItem }) {
  if (job.deadLettered) {
    return (
      <Badge variant="destructive" className="text-xs uppercase">
        dead-lettered
      </Badge>
    );
  }

  const variant =
    job.state === 'failed' ? 'destructive' : job.state === 'completed' ? 'secondary' : 'outline';

  return (
    <Badge variant={variant} className="text-xs uppercase">
      {job.state}
    </Badge>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`min-w-0 truncate ${mono ? 'font-mono text-[11px]' : ''}`} title={value}>
        {value}
      </dd>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only md:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Seconds once past a second — "33.5s" reads faster than "33546ms". */
function formatDuration(ms: number | null): string {
  if (ms == null) {
    return '—';
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatTimestamp(value?: string | null): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}
