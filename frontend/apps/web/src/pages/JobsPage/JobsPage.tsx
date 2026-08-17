import { useMemo } from 'react';

import { Portal, usePageTitle } from '@ci/common';
import { Badge, Breadcrumb, Button, Card, Skeleton } from '@ci/shadcn';
import { AlertTriangle, RefreshCcw } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';
import { Cell, Pie, PieChart } from 'recharts';

import { PageContent } from '@/components/layout';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';

import {
  expandActiveJobDistribution,
  formatJobHandlerLabel,
  formatSmartRotationJobTitle,
  SMART_ROTATION_WORK_LABELS,
} from './smartRotationLabels';
import {
  useJobsDashboard,
  type ArchivedJobRecord,
  type CronSchedule,
  type JobQueue,
  type JobRecord,
  type JobsDashboardResponse,
} from './useJobsDashboard';

const palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

/** States describing work the appliance still intends to do. */
const LIVE_JOB_STATES = new Set(['created', 'active', 'retry']);

/**
 * pg-boss copies a job here once it exhausts its retries — in state `created`,
 * which is why every "pending work" view has to exclude it by name.
 */
const DEAD_LETTER_QUEUE = 'dead-letter';

export function JobsPage() {
  usePageTitle('Jobs - Companion Intelligence');

  const { data, loading, error, staleSince, updatedAt, refresh } = useJobsDashboard();

  const jobs = data?.jobs ?? [];
  const archive = data?.archive ?? [];

  // `created`, `active` and `retry` are the only states describing work the
  // appliance still intends to do. The previous filter was `!== 'completed'`,
  // which swept `failed` and `cancelled` jobs into a column headed "Jobs waiting
  // to run or currently executing" — so a queue full of permanently failed jobs
  // read as a busy one. Dead letters are excluded outright: pg-boss inserts them
  // in state `created`, and they would otherwise dominate this column.
  const activeJobs = useMemo(
    () => jobs.filter((job) => LIVE_JOB_STATES.has(job.state) && job.queue !== DEAD_LETTER_QUEUE),
    [jobs],
  );

  // Failures, from both directions: jobs that failed on their own queue, and the
  // copies pg-boss parked on the dead-letter queue after the retries ran out.
  const failedJobs = useMemo(
    () => jobs.filter((job) => job.state === 'failed' || job.queue === DEAD_LETTER_QUEUE),
    [jobs],
  );

  const completedJobs = useMemo<ArchivedJobRecord[]>(() => {
    const archiveIds = new Set(archive.map((item) => item.id));

    const completedFromJobs = jobs
      .filter((job) => job.state === 'completed' && !archiveIds.has(job.id))
      .map<ArchivedJobRecord>((job) => ({
        ...job,
        archivedOn: job.completedOn ?? job.createdOn,
      }));

    const combined: ArchivedJobRecord[] = [...archive, ...completedFromJobs];

    return combined.sort((a, b) => {
      const aTime = new Date(a.archivedOn).getTime();
      const bTime = new Date(b.archivedOn).getTime();

      return bTime - aTime;
    });
  }, [archive, jobs]);
  const activeDistribution = useMemo(() => {
    if (!data?.activeDistribution?.length) {
      return [];
    }

    return expandActiveJobDistribution(data.activeDistribution, data.smartRotationDistribution ?? []).map(
      (segment, index) => ({
        ...segment,
        color: palette[index % palette.length],
        key: `active-${segment.jobName}-${index}`,
      }),
    );
  }, [data?.activeDistribution, data?.smartRotationDistribution]);

  const archiveDistribution = useMemo(() => {
    if (!data?.archiveDistribution?.length) {
      return [];
    }

    return data.archiveDistribution.map((segment, index) => ({
      ...segment,
      jobName: formatJobHandlerLabel(segment.jobName),
      color: palette[index % palette.length],
      key: `archive-${index}`,
    }));
  }, [data?.archiveDistribution]);

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link asChild>
                <Link to="/feed">Companion</Link>
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Jobs</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <div className="flex flex-col gap-4">
          <SummaryCard
            loading={loading}
            error={error}
            staleSince={staleSince}
            updatedAt={updatedAt}
            activeDistribution={activeDistribution}
            archiveDistribution={archiveDistribution}
            queueDistribution={data?.queueDistribution ?? []}
            smartRotationDistribution={data?.smartRotationDistribution ?? []}
            summary={data?.summary}
            onRefresh={refresh}
          />

          <ColumnsGrid
            loading={loading}
            activeJobs={activeJobs}
            failedJobs={failedJobs}
            completed={completedJobs}
            crons={data?.crons ?? []}
            queues={data?.queues ?? []}
          />
        </div>
      </PageContent>
    </>
  );
}

type SummaryCardProps = {
  loading: boolean;
  error: string | null;
  summary?: JobsDashboardResponse['summary'];
  activeDistribution: Array<{
    readonly key: string;
    readonly jobName: string;
    readonly count: number;
    readonly color: string;
  }>;
  archiveDistribution: Array<{
    readonly key: string;
    readonly jobName: string;
    readonly count: number;
    readonly color: string;
  }>;
  queueDistribution: ReadonlyArray<{ readonly queue: string; readonly count: number }>;
  smartRotationDistribution: ReadonlyArray<{ readonly workType: string; readonly count: number }>;
  staleSince: Date | null;
  updatedAt: Date | null;
  onRefresh: () => void;
};

function SummaryCard({
  loading,
  error,
  summary,
  activeDistribution,
  archiveDistribution,
  queueDistribution,
  smartRotationDistribution,
  staleSince,
  updatedAt,
  onRefresh,
}: SummaryCardProps) {
  const summaryItems = useMemo(
    () => [
      // "Pending" now means what it says. It used to include the dead-letter
      // queue, whose jobs sit in state `created` — so on a real appliance 1,191
      // jobs that had already given up were reported as waiting work, and the
      // same 1,191 were counted again under "Failed".
      { label: 'Pending', value: summary?.pending ?? 0 },
      { label: 'Running', value: summary?.active ?? 0 },
      { label: 'Retrying', value: summary?.retry ?? 0 },
      { label: 'Completed', value: summary?.completed ?? 0 },
      { label: 'Failed', value: summary?.failed ?? 0 },
      { label: 'Dead-lettered', value: summary?.deadLettered ?? 0 },
    ],
    [
      summary?.pending,
      summary?.active,
      summary?.retry,
      summary?.completed,
      summary?.failed,
      summary?.deadLettered,
    ],
  );

  return (
    <Card>
      <Card.Header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <Card.Title className="text-xl">Queue Activity</Card.Title>
          <Card.Description>
            {updatedAt ? `Updated ${formatTimestamp(updatedAt.toISOString())}` : 'Current job workload'}
          </Card.Description>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} className="w-full md:w-auto">
          <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </Card.Header>
      <Card.Content className="space-y-4">
        {staleSince ? (
          <StaleBanner since={staleSince} message={error} />
        ) : error ? (
          <ErrorBanner message={error} />
        ) : null}
        {loading && !summary ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {summaryItems.map((item) => (
              <StatTile key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        )}

        {loading && !activeDistribution.length && !archiveDistribution.length ? (
          <Skeleton className="h-60 w-full" />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <DistributionChart
              title="Active jobs by handler"
              description="Pending and in-flight work — smart rotation split by work type"
              data={activeDistribution}
              emptyMessage="No active jobs in the queue."
            />
            <DistributionChart
              title="Completed jobs by handler (lifetime)"
              description="Historical volume from the job archive"
              data={archiveDistribution}
              emptyMessage="No completed jobs have been archived yet."
            />
          </div>
        )}

        {(queueDistribution.length > 0 || smartRotationDistribution.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {queueDistribution.length > 0 ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <h3 className="text-sm font-medium">Active jobs by queue</h3>
                <dl className="mt-3 space-y-2">
                  {queueDistribution.map((item) => (
                    <div key={item.queue} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{item.queue}</span>
                      <span className="font-medium">{item.count.toLocaleString()}</span>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
            {smartRotationDistribution.length > 0 ? (
              <div className="rounded-lg border border-border/60 bg-muted/20 p-4">
                <h3 className="text-sm font-medium">Smart rotation (active / retrying)</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Same jobs as above, grouped by what each run is trying to do.
                </p>
                <dl className="mt-3 space-y-2">
                  {smartRotationDistribution.map((item) => (
                    <div key={item.workType} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">
                        {SMART_ROTATION_WORK_LABELS[item.workType] ?? item.workType}
                      </span>
                      <span className="font-medium tabular-nums">{item.count.toLocaleString()}</span>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        )}
      </Card.Content>
    </Card>
  );
}

type ColumnsGridProps = {
  loading: boolean;
  activeJobs: readonly JobRecord[];
  failedJobs: readonly JobRecord[];
  completed: readonly ArchivedJobRecord[];
  crons: readonly CronSchedule[];
  queues: readonly JobQueue[];
};

function ColumnsGrid({ loading, activeJobs, failedJobs, completed, crons, queues }: ColumnsGridProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <DataColumn
        title="Active Jobs"
        description="Queued, running, or awaiting retry"
        loading={loading}
        items={activeJobs}
        emptyMessage="Nothing queued — the appliance is idle."
        renderItem={(job) => <JobCard key={job.id} job={job} />}
      />
      <DataColumn
        title="Failures"
        description="Failed jobs and dead letters — expand one for its error"
        loading={loading}
        items={failedJobs}
        emptyMessage="No failures. "
        renderItem={(job) => <JobCard key={job.id} job={job} />}
      />
      <DataColumn
        title="Completed Jobs"
        description="Recently completed (including unarchived completions)"
        loading={loading}
        items={completed}
        emptyMessage="Nothing has completed recently."
        renderItem={(job) => <ArchivedJobCard key={job.id} job={job} />}
      />
      <DataColumn
        title="Schedules"
        description="Recurring jobs registered in this process"
        loading={loading}
        items={crons}
        emptyMessage="No recurring jobs are registered here."
        renderItem={(cron) => <CronCard key={cron.name} cron={cron} />}
      />
      <DataColumn
        title="Queues"
        description="Queue configuration and policies"
        loading={loading}
        items={queues}
        emptyMessage="No queues have been created yet."
        renderItem={(queue) => <QueueCard key={queue.name} queue={queue} />}
      />
    </div>
  );
}

type DataColumnProps<T> = {
  title: string;
  description: string;
  loading: boolean;
  items: readonly T[];
  emptyMessage?: string;
  renderItem: (item: T) => React.ReactNode;
};

function DataColumn<T>({ title, description, loading, items, emptyMessage, renderItem }: DataColumnProps<T>) {
  return (
    <Card className="flex h-full flex-col">
      <Card.Header>
        <Card.Title className="text-base">{title}</Card.Title>
        <Card.Description>{description}</Card.Description>
      </Card.Header>
      <Card.Content className="flex-1">
        {loading && !items.length ? (
          <Skeleton className="h-[320px] w-full" />
        ) : items.length ? (
          <div className="flex max-h-[420px] flex-col gap-3 overflow-y-auto pr-1">
            {items.map((item) => renderItem(item))}
          </div>
        ) : (
          // "No data available" reads as a fetch problem. Each column says what
          // its own emptiness means instead — an idle queue is good news.
          <p className="text-sm text-muted-foreground">{emptyMessage ?? 'No data available.'}</p>
        )}
      </Card.Content>
    </Card>
  );
}

type JobCardProps = {
  job: JobRecord;
};

function JobCard({ job }: JobCardProps) {
  const { title, subtitle } = getJobDisplay(job);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="block font-medium truncate" title={title}>
            {title}
          </span>
          {subtitle ? (
            <span className="block truncate text-xs text-muted-foreground" title={subtitle}>
              {subtitle}
            </span>
          ) : null}
        </div>
        <Badge variant="outline" className="shrink-0 text-xs uppercase">
          {job.state}
        </Badge>
      </div>
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        <KeyValue label="Queue" value={job.queue} />
        <KeyValue label="Created" value={formatTimestamp(job.createdOn)} />
        <KeyValue label="Start after" value={formatTimestamp(job.startAfter)} />
        {job.startedOn ? <KeyValue label="Started" value={formatTimestamp(job.startedOn)} /> : null}
        {job.completedOn ? <KeyValue label="Completed" value={formatTimestamp(job.completedOn)} /> : null}
        <KeyValue label="Retries" value={`${job.retryCount}/${job.retryLimit}`} />
      </dl>
      <JobFailureDetail job={job} />
    </div>
  );
}

/**
 * Why a job failed.
 *
 * The API has always had this: the worker writes `{ message, stack, failedAt }`
 * into `pgboss.job.output` on every failure and `JobMonitorService` selects it —
 * but the page dropped it on the floor. So the dashboard could tell an operator
 * that 1,191 jobs had failed and nothing whatsoever about why, while the answer
 * sat in memory one property away. On the appliance this was written against,
 * 628 of those failures were a single missing binary ("Cannot find ffmpeg").
 *
 * The parsing now happens server-side (`JobMonitorService.toFailure`), because
 * `output` also holds deliberate success payloads from deferred completions and
 * those can carry user data — so only the three known failure fields cross the
 * wire at all.
 *
 * Collapsed by default — the stack traces are long and most jobs never fail —
 * and rendered with `<details>` so it costs no state and stays keyboard- and
 * screen-reader-navigable for free.
 */
function JobFailureDetail({ job }: { job: JobRecord }) {
  const { failure } = job;

  if (!failure) {
    return null;
  }

  return (
    <details className="mt-2 rounded-md border border-destructive/30 bg-destructive/5">
      <summary className="cursor-pointer list-none px-2 py-1.5 text-xs font-medium text-destructive marker:hidden">
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" title={failure.message}>
            {failure.message}
          </span>
        </span>
      </summary>
      <div className="space-y-2 border-t border-destructive/20 px-2 py-2">
        {failure.failedAt ? (
          <dl className="text-xs text-muted-foreground">
            <KeyValue label="Failed at" value={formatTimestamp(failure.failedAt)} />
          </dl>
        ) : null}
        {failure.stack ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2 text-[11px] leading-snug text-muted-foreground">
            {failure.stack}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

type ArchivedJobCardProps = {
  job: ArchivedJobRecord;
};

function ArchivedJobCard({ job }: ArchivedJobCardProps) {
  const { title, subtitle } = getJobDisplay(job);

  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="block font-medium truncate" title={title}>
            {title}
          </span>
          {subtitle ? (
            <span className="block truncate text-xs text-muted-foreground" title={subtitle}>
              {subtitle}
            </span>
          ) : null}
        </div>
        <Badge
          variant={job.state === 'completed' ? 'secondary' : 'destructive'}
          className="shrink-0 text-xs uppercase"
        >
          {job.state}
        </Badge>
      </div>
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        <KeyValue label="Queue" value={job.queue} />
        <KeyValue label="Archived" value={formatTimestamp(job.archivedOn)} />
        {job.completedOn ? <KeyValue label="Completed" value={formatTimestamp(job.completedOn)} /> : null}
        {job.deadLetter ? <KeyValue label="Dead letter" value={job.deadLetter} /> : null}
        <KeyValue label="Retries" value={`${job.retryCount}/${job.retryLimit}`} />
      </dl>
      <JobFailureDetail job={job} />
    </div>
  );
}

type CronCardProps = {
  cron: CronSchedule;
};

/**
 * A recurring job as this appliance actually schedules them.
 *
 * The column this replaces rendered `pgboss.schedule`, which nothing in the
 * codebase writes — no call to `boss.schedule()` exists — so it showed an empty
 * list on every appliance ever shipped while ~34 NestJS `@Cron` methods ran
 * beside it, invisible. These come from Nest's live `SchedulerRegistry`, so the
 * list is what is registered in this process, `role` gating included.
 */
function CronCard({ cron }: CronCardProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 flex-1 font-medium truncate" title={cron.name}>
          {cron.name}
        </span>
        <Badge variant={cron.running ? 'outline' : 'secondary'} className="shrink-0 text-xs uppercase">
          {cron.running ? 'scheduled' : 'stopped'}
        </Badge>
      </div>
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        <KeyValue label="Expression" value={cron.cron || '—'} />
        {cron.timezone ? <KeyValue label="Time zone" value={cron.timezone} /> : null}
        <KeyValue label="Next run" value={cron.nextRunAt ? formatTimestamp(cron.nextRunAt) : '—'} />
        <KeyValue label="Last run" value={cron.lastRunAt ? formatTimestamp(cron.lastRunAt) : 'not yet'} />
      </dl>
    </div>
  );
}

type QueueCardProps = {
  queue: JobQueue;
};

function QueueCard({ queue }: QueueCardProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium truncate" title={queue.name}>
          {queue.name}
        </span>
        <Badge variant="outline" className="text-xs uppercase">
          {queue.policy ?? 'standard'}
        </Badge>
      </div>
      <dl className="mt-2 space-y-1 text-xs text-muted-foreground">
        <KeyValue label="Retry limit" value={String(queue.retryLimit)} />
        <KeyValue label="Retry delay" value={`${queue.retryDelay}s`} />
        <KeyValue label="Backoff" value={queue.retryBackoff ? 'enabled' : 'disabled'} />
        {queue.expireInSeconds !== null && queue.expireInSeconds !== undefined ? (
          <KeyValue label="Expires" value={`${queue.expireInSeconds}s`} />
        ) : null}
        {queue.retentionMinutes !== null && queue.retentionMinutes !== undefined ? (
          <KeyValue label="Retention" value={`${queue.retentionMinutes}m`} />
        ) : null}
        <KeyValue label="Created" value={formatTimestamp(queue.createdOn)} />
        <KeyValue label="Updated" value={queue.updatedOn ? formatTimestamp(queue.updatedOn) : '—'} />
        {queue.deadLetter ? <KeyValue label="DLQ" value={queue.deadLetter} /> : null}
      </dl>
    </div>
  );
}

type KeyValueProps = {
  label: string;
  value: string;
};

function KeyValue({ label, value }: KeyValueProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground/80">{label}</span>
      <span className="font-medium text-foreground/80">{value}</span>
    </div>
  );
}

type StatTileProps = {
  label: string;
  value: number;
};

function StatTile({ label, value }: StatTileProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-4">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

type ErrorBannerProps = {
  message: string;
};

function ErrorBanner({ message }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

/**
 * Shown when refreshes are failing but the last good data is still on screen.
 *
 * Without this the page kept auto-refreshing and silently kept displaying
 * whatever it had last received, so a dead API looked identical to a quiet
 * queue. An operator watching a backlog drain could not tell "nothing changed"
 * from "nothing is being reported".
 */
function StaleBanner({ since, message }: { since: Date; message: string | null }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
    >
      <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">
        Showing data from {formatTimestamp(since.toISOString())} — refreshes have been failing since then
        {message ? ` (${message})` : ''}.
      </span>
    </div>
  );
}

function DistributionChart({
  title,
  description,
  data,
  emptyMessage,
}: {
  title: string;
  description: string;
  data: Array<{
    readonly key: string;
    readonly jobName: string;
    readonly count: number;
    readonly color: string;
  }>;
  emptyMessage: string;
}) {
  if (!data.length) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-muted-foreground">{description}</p>
      <ChartContainer config={{}} className="mt-2 h-[240px] w-full">
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="jobName"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            stroke="transparent"
          >
            {data.map((segment) => (
              <Cell key={segment.key} fill={segment.color} />
            ))}
          </Pie>
          <ChartTooltip
            cursor={{ fill: 'hsla(var(--muted), 0.35)' }}
            content={
              <ChartTooltipContent
                hideLabel
                formatter={(value, _name, { payload }) => {
                  return (
                    <div className="flex w-full items-center justify-between gap-6">
                      <span>{payload.jobName}</span>
                      <span className="font-medium">{value as number}</span>
                    </div>
                  );
                }}
              />
            }
          />
        </PieChart>
      </ChartContainer>
    </div>
  );
}

function formatTimestamp(value?: string) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

/**
 * What to call a job on its card.
 *
 * Reads the projected `event`/`workType` rather than the raw payload — those are
 * the only two fields this ever needed, which is what made redacting the payload
 * server-side lossless. Falls back to the queue name: a job with no event name
 * is still a job on a queue, and "Unnamed job" repeated down a column tells an
 * operator less than the queue does.
 */
function getJobDisplay(job: JobRecord): { title: string; subtitle?: string } {
  const rotationTitle = formatSmartRotationJobTitle({ name: job.event, workType: job.workType });

  if (rotationTitle) {
    return { title: rotationTitle, subtitle: 'smart.rotation.work' };
  }

  if (job.event) {
    return { title: job.event };
  }

  return { title: job.queue, subtitle: 'no event name' };
}
