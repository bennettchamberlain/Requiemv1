import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Context, type RequestContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';

import { IMPORT_STAGE_KINDS, type ImportStageKindName } from '../constants';
import { recognizePathWithinRoots, type PathRecognition } from '../datasources/recognizePath';
import { allDataSources } from '../datasources/registry';
import type { ImportRun } from '../entities/ImportRunEntity';
import type { ImportStage } from '../entities/ImportStageEntity';
import {
  DataSourceCatalogService,
  type DataSourceSummary,
  type SourceCatalogEntry,
} from '../services/DataSourceCatalogService';
import { ImportRunService } from '../services/ImportRunService';

/** A run as the progress UI reads it. */
export interface RunSummary {
  id: string;
  label: string | null;
  source: string;
  /**
   * The services this run turned out to contain, most rows first — what the run
   * list names it, since the label is only the uploaded archive's filename.
   * Empty until the parse stage has run.
   */
  dataSources: string[];
  /**
   * The importer(s) the user's service card stood for when this run was
   * started from the wizard — see ImportRunEntity.declaredSources. Null when
   * nothing was declared.
   */
  declaredSources: string[] | null;
  status: string;
  percent: number;
  /** Stage kinds this run intends to execute, so the bar can be drawn on the first poll. */
  requestedStages: string[];
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  /**
   * Rows this run actually WROTE into `ci.*` — the push stage's `detail.pushed`.
   *
   * Deliberately not the push stage's `processed`, which is a progress number
   * that also counts rows already present, rows that failed, and entity
   * resolutions. Present on the LIST only: it is one grouped query for the
   * whole page, which is what lets a caller report a run's yield without
   * fetching every run's stages. Zero for a run that has not pushed yet.
   */
  records?: number;
}

/** One box of the stage bar. */
export interface StageSummary {
  id: string;
  seq: number;
  kind: string;
  status: string;
  phase: string | null;
  processed: number;
  /** Null means "not yet countable" — the UI must draw an indeterminate bar, not 0%. */
  total: number | null;
  weight: number;
  etaSeconds: number | null;
  durationMs: number | null;
  error: string | null;
  detail: Record<string, unknown>;
}

export interface RunDetail extends RunSummary {
  stages: StageSummary[];
}

export interface StartRunBody {
  /** The staged upload to import. */
  dropId?: string;
  label?: string;
  /**
   * Stage kinds to run, in order. Omit for the whole import.
   *
   * The useful narrowing is `['unpack']` alone: it expands the archive without
   * committing to an import, so a caller can ask what is inside before deciding.
   */
  stages?: string[];
  /**
   * The importer name(s) the user's chosen service card covers — what makes
   * the picker's "imported" mark trustworthy. Validated against the importer
   * registry; omit when the upload carries no such intent (generic drops).
   */
  declaredSources?: string[];
}

/** A run whose parsed rows are waiting for a push, with what is waiting. */
export interface UnpushedRunSummary extends RunSummary {
  pendingItems: number;
  pendingEntities: number;
}

export interface StartPushBody {
  /** Restrict the push to these runs. Omit to push everything unpushed. */
  runIds?: string[];
}

export interface RecognizeBody {
  /** Absolute path on the appliance, within a configured import root. */
  path?: string;
}

/**
 * The user-facing surface of an import.
 *
 * Separate from `/jobs`, which renders pg-boss for an operator. These two answer
 * different questions for different people — "is my Google Takeout finished?"
 * against "what is the queue doing?" — and merging them would make both worse.
 */
@Controller('import')
export class ImportRunsController {
  constructor(
    private readonly runs: ImportRunService,
    private readonly catalog: DataSourceCatalogService,
  ) {}

  /**
   * What this appliance can import.
   *
   * Includes importers marked `stub`: someone looking for their export should
   * learn the appliance knows the format and has not implemented it yet, rather
   * than concluding it is unsupported.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('sources')
  listSources(): DataSourceSummary[] {
    return this.catalog.list();
  }

  /**
   * Every AUTHORED source, for the wizard's picker — where `sources` above is
   * keyed by importer, this is keyed by service: sources sharing one parser
   * each get a row, and a source whose importer is not written yet appears
   * with `importerReady: false` instead of being invisible. Order is the
   * curated array order; the frontend must not re-sort it.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('sources/catalog')
  sourceCatalog(): SourceCatalogEntry[] {
    return this.catalog.catalog();
  }

  /**
   * What every parser makes of a path the appliance can already see.
   *
   * The read-before-you-commit question, and the one thing the rest of this
   * controller cannot answer: everywhere else an archive is opaque bytes until a
   * run unpacks it, so `runs/:runId/recognized` reports what the parse stage
   * found — after the import. This answers first, which is what makes
   * `ci-import recognize` (and the identical `import.recognize_path` MCP tool,
   * which shares the implementation) able to say "that folder is a Google
   * Takeout" before anything is written.
   *
   * POST, not GET, because the argument is a filesystem path: a query string
   * ends up in access logs and proxy history, and the reply is not cacheable
   * anyway — the folder it describes changes.
   *
   * Confined to `CI_IMPORT_ROOTS`, exactly as the MCP tool is. A path outside
   * them answers `allowed: false` with the remedy rather than 4xx: "not
   * permitted, upload instead" is a state the caller renders, not a fault.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('recognize')
  async recognize(@Body() body: RecognizeBody): Promise<PathRecognition> {
    if (!body?.path) {
      throw new BadRequestException('path is required');
    }

    return recognizePathWithinRoots(body.path);
  }

  /** Start importing a staged upload. */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('runs')
  async start(@Context() context: RequestContext, @Body() body: StartRunBody): Promise<RunDetail> {
    const userId = requireUserId(context);

    if (!body?.dropId) {
      throw new BadRequestException('dropId is required');
    }

    const { run, stages } = await this.runs.startRun(
      { userId },
      {
        dropId: body.dropId,
        label: body.label,
        source: 'api',
        stages: parseStages(body.stages),
        declaredSources: parseDeclaredSources(body.declaredSources),
      },
    );

    return { ...toRunSummary(run), stages: stages.map(toStageSummary) };
  }

  /**
   * This user's runs, newest first, keyset-paged.
   *
   * `beforeCreatedAt` + `beforeId` (both or neither) are the last row of the
   * page already shown; the response is runs strictly older than it. Cursor
   * rather than offset because a Takeout session creates runs WHILE history is
   * being read — an offset page shifts under new rows, a cursor cannot. The
   * response stays a bare array: a page shorter than `limit` is the last one.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('runs')
  async list(
    @Context() context: RequestContext,
    @Query('limit') limit?: string,
    @Query('beforeCreatedAt') beforeCreatedAt?: string,
    @Query('beforeId') beforeId?: string,
  ): Promise<RunSummary[]> {
    const userId = requireUserId(context);
    const parsed = limit == null ? undefined : Number(limit);
    const runs = await this.runs.listRuns(
      { userId },
      {
        limit: Number.isFinite(parsed) ? parsed : undefined,
        before: parseBeforeCursor(beforeCreatedAt, beforeId),
      },
    );

    return runs.map((run) => ({ ...toRunSummary(run), records: run.records }));
  }

  /**
   * The runs the Sync card offers: parse finished, nothing pushed yet.
   *
   * MUST stay declared above `runs/:runId` — route registration follows
   * declaration order, and below it Express would match `unpushed` as a runId.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('runs/unpushed')
  async listUnpushed(@Context() context: RequestContext): Promise<UnpushedRunSummary[]> {
    const userId = requireUserId(context);
    const unpushed = await this.runs.listUnpushed({ userId });

    return unpushed.map(({ run, pendingItems, pendingEntities }) => ({
      ...toRunSummary(run),
      pendingItems,
      pendingEntities,
    }));
  }

  /** One run, with its stage bar. The poll target while an import is in flight. */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('runs/:runId')
  async get(@Context() context: RequestContext, @Param('runId') runId: string): Promise<RunDetail> {
    const userId = requireUserId(context);
    const detail = await this.runs.getRunDetail({ userId }, runId);

    if (detail == null) {
      throw new NotFoundException(`No import run ${runId}`);
    }

    return { ...toRunSummary(detail.run), stages: detail.stages.map(toStageSummary) };
  }

  /**
   * What a run found in the upload.
   *
   * Answerable once `unpack` has finished, because that is when there is a tree
   * to look at — the staged upload itself is an opaque archive. Reads what
   * the parse stage recorded rather than re-scanning, so asking twice costs
   * nothing and the answer matches what actually got imported.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get('runs/:runId/recognized')
  async recognized(
    @Context() context: RequestContext,
    @Param('runId') runId: string,
  ): Promise<{ recognized: DataSourceSummary[]; pending: boolean }> {
    const userId = requireUserId(context);
    const detail = await this.runs.getRunDetail({ userId }, runId);

    if (detail == null) {
      throw new NotFoundException(`No import run ${runId}`);
    }

    const parse = detail.stages.find((stage) => stage.kind === 'parse');
    const names = Array.isArray(parse?.detail?.recognized)
      ? (parse.detail.recognized as unknown[]).filter((name): name is string => typeof name === 'string')
      : [];

    return {
      recognized: names
        .map((name) => this.catalog.find(name))
        .filter((source): source is DataSourceSummary => source != null),
      // The honest "ask again later": the parse has not run, so an empty list
      // here means unknown rather than nothing.
      pending: parse == null || parse.status === 'queued' || parse.status === 'running',
    };
  }

  /** Stop a run the user no longer wants. */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('runs/:runId/cancel')
  async cancel(
    @Context() context: RequestContext,
    @Param('runId') runId: string,
  ): Promise<{ cancelled: boolean }> {
    const userId = requireUserId(context);
    const cancelled = await this.runs.cancel({ userId }, runId);

    if (!cancelled) {
      throw new NotFoundException(`No import run ${runId} still in flight`);
    }

    return { cancelled };
  }

  /**
   * Re-run a stage that failed.
   *
   * The counterpart to the worker NOT retrying on its own: a redelivered job
   * no-ops so a transient blip cannot silently re-unpack a 40GB archive,
   * which leaves asking for it as a deliberate act.
   */
  /**
   * The wizard's Sync: push everything staged and never pushed.
   *
   * An empty answer is `{ runs: [] }`, not an error — "nothing to sync" is a
   * state the Sync card renders, not a fault. Progress after this call is the
   * ordinary run poll; nothing here is worth a second live surface.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('push')
  async startPush(
    @Context() context: RequestContext,
    @Body() body?: StartPushBody,
  ): Promise<{ runs: RunSummary[] }> {
    const userId = requireUserId(context);
    const started = await this.runs.startPush({ userId }, { runIds: parseRunIds(body?.runIds) });

    return { runs: started.map(({ run }) => toRunSummary(run)) };
  }

  /**
   * Push the rows a completed push could not write.
   *
   * The counterpart to the stage retry below, for the other kind of failure: a
   * push that mostly worked leaves its casualties at `push_status = 'failed'`,
   * where nothing looks at them again — the push reads only `pending`, Sync
   * skips a run that already has a push stage, and a stage retry refuses a
   * stage that completed. This resets those rows and re-queues the push.
   *
   * `{ items: 0, entities: 0 }` is a fine answer, not an error: it means there
   * was nothing stranded, which is what the caller wanted to be true.
   */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('runs/:runId/push/retry')
  async retryFailedPush(
    @Context() context: RequestContext,
    @Param('runId') runId: string,
  ): Promise<{ items: number; entities: number; requeued: boolean }> {
    const userId = requireUserId(context);
    const result = await this.runs.retryFailedPush({ userId }, runId);

    if (result == null) {
      throw new NotFoundException(`No import run ${runId}`);
    }

    return result;
  }

  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('runs/:runId/stages/:stageId/retry')
  async retryStage(
    @Context() context: RequestContext,
    @Param('runId') runId: string,
    @Param('stageId') stageId: string,
  ): Promise<{ requeued: boolean }> {
    const userId = requireUserId(context);
    const requeued = await this.runs.retryStage({ userId }, runId, stageId);

    if (!requeued) {
      throw new NotFoundException(
        `No failed or cancelled stage ${stageId} on run ${runId} — only those can be re-run`,
      );
    }

    return { requeued };
  }
}

function requireUserId(context: RequestContext): string {
  if (!context.userId) {
    throw new BadRequestException('An authenticated user is required');
  }

  return context.userId;
}

/**
 * Validate a caller-supplied stage list against the closed vocabulary.
 *
 * A typo would otherwise create a stage no runner can execute, which the worker
 * fails loudly but only after the run has started — better to refuse it here,
 * where the caller can still fix it.
 */
/**
 * Validate a caller-supplied run-id filter as UUID-shaped.
 *
 * The service binds these to a `$n::uuid[]` cast, where a typo becomes a
 * Postgres syntax error — a 500 wearing the wrong blame. Refusing here names
 * the offending values while the caller can still fix them, the same bargain
 * `parseStages` makes.
 */
function parseRunIds(runIds: string[] | undefined): string[] | undefined {
  if (runIds == null) {
    return undefined;
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalid = runIds.filter((id) => !UUID.test(id));

  if (invalid.length > 0) {
    throw new BadRequestException(`Not import run ids: ${invalid.join(', ')}`);
  }

  return runIds;
}

function parseStages(stages: string[] | undefined): ImportStageKindName[] | undefined {
  if (stages == null) {
    return undefined;
  }

  const invalid = stages.filter((stage) => !(IMPORT_STAGE_KINDS as readonly string[]).includes(stage));

  if (invalid.length > 0) {
    throw new BadRequestException(
      `Unknown import stage(s): ${invalid.join(', ')}. Valid stages: ${IMPORT_STAGE_KINDS.join(', ')}`,
    );
  }

  return stages as ImportStageKindName[];
}

/**
 * Validate a declared-source list against the importer registry.
 *
 * Strict, because these strings become the picker's "you imported this"
 * evidence: an unknown name would sit in the column forever, crediting
 * nothing (harmless) or — worse — colliding with an importer added later
 * (a claim nobody made). Deduplicated and capped so a buggy caller cannot
 * grow the column without bound.
 */
function parseDeclaredSources(declared: string[] | undefined): string[] | undefined {
  if (declared == null) {
    return undefined;
  }

  if (!Array.isArray(declared) || declared.some((name) => typeof name !== 'string')) {
    throw new BadRequestException('declaredSources must be an array of importer names');
  }

  const known = new Set(allDataSources().map((source) => source.name));
  const unique = [...new Set(declared)];
  const invalid = unique.filter((name) => !known.has(name));

  if (invalid.length > 0) {
    throw new BadRequestException(`Unknown declared source(s): ${invalid.join(', ')}`);
  }

  if (unique.length > 64) {
    throw new BadRequestException('declaredSources: too many entries');
  }

  return unique.length > 0 ? unique : undefined;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The pagination cursor, validated strictly: both halves or neither, a real
 * timestamp, a real uuid. Query params bypass `IdFormatGuard` (it reads route
 * params), and `beforeId` reaches a `::uuid` cast — a malformed value must be
 * a 400 here, not a 500 there.
 */
function parseBeforeCursor(
  beforeCreatedAt: string | undefined,
  beforeId: string | undefined,
): { createdAt: Date; id: string } | undefined {
  if (beforeCreatedAt == null && beforeId == null) {
    return undefined;
  }

  if (beforeCreatedAt == null || beforeId == null) {
    throw new BadRequestException('beforeCreatedAt and beforeId must be provided together');
  }

  const createdAt = new Date(beforeCreatedAt);

  if (Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException('beforeCreatedAt must be a valid timestamp');
  }

  if (!UUID_RE.test(beforeId)) {
    throw new BadRequestException('beforeId must be a uuid');
  }

  return { createdAt, id: beforeId };
}

function toRunSummary(run: ImportRun): RunSummary {
  return {
    id: run.id,
    label: run.label,
    source: run.source,
    dataSources: run.dataSources,
    declaredSources: run.declaredSources,
    status: run.status,
    percent: run.percent,
    requestedStages: run.requestedStages,
    error: run.error,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}

function toStageSummary(stage: ImportStage): StageSummary {
  return {
    id: stage.id,
    seq: stage.seq,
    kind: stage.kind,
    status: stage.status,
    phase: stage.phase,
    processed: Number(stage.processed),
    total: stage.total == null ? null : Number(stage.total),
    weight: stage.weight,
    etaSeconds: stage.etaSeconds,
    durationMs: stage.durationMs == null ? null : Number(stage.durationMs),
    error: stage.error,
    detail: stage.detail ?? {},
  };
}
