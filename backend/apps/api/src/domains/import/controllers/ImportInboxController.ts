import { BadRequestException, Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

import { Context, type RequestContext } from '@ci/common/context';
import { JwtOrApiKeyAuthGuard } from '@ci/common/guards';

import { ImportInboxService, type InboxBatchResult, type InboxScan } from '../services/ImportInboxService';

export interface StartInboxRunsBody {
  /**
   * Relative paths from a scan. Omit to import everything the scan yields
   * that is not already being imported.
   */
  units?: string[];
  label?: string | null;
}

/**
 * The inbox: a mounted folder a user moves export archives into, imported in
 * batches instead of uploaded one drag at a time.
 *
 * Everything in it is a copy the importer owns — consumed by the run that
 * claims it, deleted with the completed run. The response shapes come straight
 * from {@link ImportInboxService}; per-unit errors ride inside a 200, because
 * "forty started, one was already claimed" is a result, not a failure.
 *
 * Prefix `import/inbox`, deliberately separate from `import/runs/...` so the
 * `runs/unpushed`-above-`runs/:runId` ordering rule gains no new neighbors.
 */
@Controller('import/inbox')
export class ImportInboxController {
  constructor(private readonly inbox: ImportInboxService) {}

  /** What is waiting in the inbox folder. */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Get()
  async scan(@Context() context: RequestContext): Promise<InboxScan> {
    return this.inbox.scan({ userId: requireUserId(context) });
  }

  /** Start one import run per unit. */
  @UseGuards(JwtOrApiKeyAuthGuard)
  @Post('runs')
  async start(
    @Context() context: RequestContext,
    @Body() body: StartInboxRunsBody | undefined,
  ): Promise<InboxBatchResult> {
    return this.inbox.startBatch(
      { userId: requireUserId(context) },
      { units: body?.units, label: body?.label ?? null, source: 'api' },
    );
  }
}

function requireUserId(context: RequestContext): string {
  if (!context.userId) {
    throw new BadRequestException('An authenticated user is required to use the import inbox');
  }

  return context.userId;
}
