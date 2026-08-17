import { useCallback, useMemo, useState } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Badge, Breadcrumb, Button, Card, Skeleton } from '@ci/shadcn';
import { AlertTriangle, RefreshCcw } from '@ci/shadcn/icons';

import { PageContent } from '@/components/layout';

import { JobHistoryCharts } from './JobHistoryCharts';
import { JobsTable } from './JobsTable';
import { COMPACT_CARD } from './layout';
import { useJobHistory } from './useJobHistory';
import { useJobsDashboard, type JobsDashboardResponse } from './useJobsDashboard';
import { DEFAULT_JOB_FILTERS, useJobsList, type JobFilters } from './useJobsList';

/** Category keys the API's taxonomy exposes, in the order the filter lists them. */
const CATEGORIES = [
  'search',
  'ingest',
  'enrich',
  'graph',
  'pipeline',
  'import',
  'llm',
  'personalization',
  'maintenance',
] as const;

export function JobsPage() {
  usePageTitle('Jobs - Companion Intelligence');

  const [filters, setFilters] = useState<JobFilters>(DEFAULT_JOB_FILTERS);
  const [windowHours, setWindowHours] = useState(24);

  const dashboard = useJobsDashboard();
  const list = useJobsList(filters);
  const history = useJobHistory(windowHours, filters.queue);

  const onFilterChange = useCallback((next: Partial<JobFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
  }, []);

  const refreshAll = useCallback(() => {
    void dashboard.refresh();
    void list.refresh();
    void history.refresh();
  }, [dashboard, list, history]);

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item>
              <Breadcrumb.Page>Jobs</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <div className="flex flex-col gap-3">
          <SummaryCard
            summary={dashboard.data?.summary}
            loading={dashboard.loading}
            error={dashboard.error}
            staleSince={dashboard.staleSince}
            updatedAt={dashboard.updatedAt}
            onRefresh={refreshAll}
            onSelectState={(state) => onFilterChange({ state, offset: 0 })}
          />

          <JobHistoryCharts
            data={history.data}
            loading={history.loading}
            error={history.error}
            windowHours={windowHours}
            onWindowChange={setWindowHours}
            queue={filters.queue}
          />

          <JobsTable
            data={list.data}
            loading={list.loading}
            error={list.error}
            filters={filters}
            categories={CATEGORIES}
            onChange={onFilterChange}
          />

          <SchedulesCard crons={dashboard.data?.crons ?? []} loading={dashboard.loading} />
        </div>
      </PageContent>
    </>
  );
}

type SummaryCardProps = {
  summary?: JobsDashboardResponse['summary'];
  loading: boolean;
  error: string | null;
  staleSince: Date | null;
  updatedAt: Date | null;
  onRefresh: () => void;
  onSelectState: (state: string) => void;
};

function SummaryCard({
  summary,
  loading,
  error,
  staleSince,
  updatedAt,
  onRefresh,
  onSelectState,
}: SummaryCardProps) {
  // Each tile is a shortcut into the table below it — a number an operator
  // cannot click is a number they have to go hunting for.
  const tiles = useMemo(
    () => [
      { label: 'Pending', value: summary?.pending ?? 0, state: 'created' },
      { label: 'Running', value: summary?.active ?? 0, state: 'active' },
      { label: 'Retrying', value: summary?.retry ?? 0, state: 'retry' },
      { label: 'Completed', value: summary?.completed ?? 0, state: 'completed' },
      { label: 'Failed', value: summary?.failed ?? 0, state: 'failed' },
      { label: 'Dead-lettered', value: summary?.deadLettered ?? 0, state: 'dead-letter' },
    ],
    [summary],
  );

  return (
    <Card className={COMPACT_CARD}>
      <Card.Header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <Card.Title className="text-lg">Queue Activity</Card.Title>
          <Card.Description>
            {updatedAt
              ? `Updated ${new Intl.DateTimeFormat(undefined, {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                }).format(updatedAt)}`
              : 'Current job workload'}
          </Card.Description>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} className="w-full md:w-auto">
          <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </Card.Header>
      <Card.Content className="space-y-3">
        {staleSince ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">
              Showing data from {staleSince.toLocaleTimeString()} — refreshes have been failing
              since then{error ? ` (${error})` : ''}.
            </span>
          </div>
        ) : error ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </div>
        ) : null}

        {loading && !summary ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map((tile) => (
              <button
                key={tile.label}
                type="button"
                onClick={() => onSelectState(tile.state)}
                className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/60"
              >
                <p className="text-xs uppercase text-muted-foreground">{tile.label}</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums">
                  {tile.value.toLocaleString()}
                </p>
              </button>
            ))}
          </div>
        )}
      </Card.Content>
    </Card>
  );
}

/**
 * The recurring jobs, from Nest's live scheduler registry.
 *
 * The column this replaces rendered `pgboss.schedule`, which nothing in this
 * codebase writes — so it was empty on every appliance ever shipped while ~34
 * `@Cron` methods ran beside it, invisible.
 */
function SchedulesCard({
  crons,
  loading,
}: {
  crons: JobsDashboardResponse['crons'];
  loading: boolean;
}) {
  return (
    <Card className={COMPACT_CARD}>
      <Card.Header>
        <Card.Title className="text-base">Schedules</Card.Title>
        <Card.Description>
          Recurring jobs registered in this process ({crons.length})
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {loading && !crons.length ? (
          <Skeleton className="h-32 w-full" />
        ) : !crons.length ? (
          <p className="text-sm text-muted-foreground">No recurring jobs are registered here.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {crons.map((cron) => (
              <div
                key={cron.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-1.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium" title={cron.name}>
                    {cron.name}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{cron.cron || '—'}</p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge
                    variant={cron.running ? 'outline' : 'secondary'}
                    className="text-[10px] uppercase"
                  >
                    {cron.running ? 'scheduled' : 'stopped'}
                  </Badge>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {cron.nextRunAt
                      ? `next ${new Date(cron.nextRunAt).toLocaleTimeString()}`
                      : 'no next run'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card.Content>
    </Card>
  );
}
