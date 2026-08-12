import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { ImportRunService } from '@ci/domains/import';

import { BaseTool } from '../core/BaseTool';
import type { IntentDefinition, ToolExecutionContext } from '../core/types';


interface RunStatusInput {
  runId?: string;
}

/**
 * How is my import going?
 *
 * The counterpart to `import.import_path` returning immediately. With no run id
 * it reports the most recent runs, which is what "did my import finish?" means
 * when the caller never held onto an id.
 *
 * The wording matters more here than in most tools, because an agent will read
 * it out loud. `partial` is reported as a success with gaps, and the counts that
 * explain the gaps travel with it — an assistant that says "your import failed"
 * when five of six sources landed has given the user a reason to redo an hour of
 * work for nothing.
 */
@Injectable()
export class ImportRunStatusTool extends BaseTool<RunStatusInput, unknown> {
  readonly schema: IntentDefinition = {
    name: 'import.run_status',
    domain: 'import',
    title: 'Check an import',
    privacy: { access: 'read', sensitivity: 'personal', destructive: false, external: false },
    // Run state lives in the server's ci_import schema and is not mirrored on-device.
    localCapable: false,
    phrases: ['How is my import going', 'Did my import finish', 'What happened to my import'],
    description:
      'Report the progress of an import run: overall status and percentage, and per-stage state ' +
      'with what each stage found. Without a run id, reports the most recent runs. A "partial" run ' +
      'is a success with gaps, not a failure.',
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        runId: {
          type: 'string',
          description: 'The run to report on. Omit for the most recent runs.',
        },
      },
    },
  };

  constructor(
    private readonly runs: ImportRunService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(ImportRunStatusTool.name);
  }

  protected async executeInternal(context: ToolExecutionContext, input: RunStatusInput) {
    if (!context.userId) {
      throw new Error('An authenticated user is required');
    }

    const ctx = { userId: context.userId };

    if (!input?.runId) {
      const recent = await this.runs.listRuns(ctx, { limit: 5 });

      return {
        runs: recent.map((run) => ({
          runId: run.id,
          label: run.label,
          status: run.status,
          summary: describeStatus(run.status),
          percent: run.percent,
          finished: run.finishedAt != null,
        })),
      };
    }

    const detail = await this.runs.getRunDetail(ctx, input.runId);

    if (detail == null) {
      return { found: false, reason: `No import run ${input.runId}` };
    }

    return {
      found: true,
      runId: detail.run.id,
      label: detail.run.label,
      status: detail.run.status,
      summary: describeStatus(detail.run.status),
      percent: detail.run.percent,
      finished: detail.run.finishedAt != null,
      error: detail.run.error,
      stages: detail.stages.map((stage) => ({
        kind: stage.kind,
        status: stage.status,
        phase: stage.phase,
        processed: Number(stage.processed),
        // Null rather than 0: the stage cannot count its work yet, which is a
        // different thing from having done none of it.
        total: stage.total == null ? null : Number(stage.total),
        error: stage.error,
        detail: stage.detail ?? {},
      })),
    };
  }
}

/** One sentence an assistant can say out loud without misleading anyone. */
function describeStatus(status: string): string {
  switch (status) {
    case 'queued':
      return 'Waiting to start.';
    case 'running':
      return 'Importing now.';
    case 'completed':
      return 'Finished. Everything in the archive was imported.';
    case 'partial':
      return 'Finished, but some of the archive was skipped. The stage details say what and why.';
    case 'failed':
      return 'Failed. The error explains where, and the failed stage can be re-run.';
    case 'cancelled':
      return 'Cancelled before it finished.';
    default:
      return status;
  }
}
