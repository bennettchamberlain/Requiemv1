import { BadRequestException, Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { ImportInboxService } from '@ci/domains/import';

import { BaseTool } from '../core/BaseTool';
import type { IntentDefinition, ToolExecutionContext } from '../core/types';

interface ImportInboxInput {
  units?: string[];
  label?: string;
}

/**
 * Import what is waiting in the inbox — one run per unit.
 *
 * The inbox is consume-and-delete territory: everything in it is a copy the
 * importer owns, and a successful import removes it (a directory leaves the
 * folder when its run starts unpacking; the bytes survive in the run's working
 * area until the run completes, and are retained for retry if it fails).
 *
 * `destructive: true`, unlike `import.import_path`, and deliberately so. That
 * tool copies and never unlinks, so re-running it is a true no-op. This one
 * removes entries from a folder the user manages — the surprise class the flag
 * exists to gate — and once a unit is consumed, "run it again" needs the user
 * to put a new copy in the inbox. A dispatcher should require its higher bar.
 */
@Injectable()
export class ImportInboxTool extends BaseTool<ImportInboxInput, unknown> {
  readonly schema: IntentDefinition = {
    name: 'import.import_inbox',
    domain: 'import',
    title: 'Import the inbox',
    privacy: { access: 'write', sensitivity: 'personal', destructive: true, external: false },
    // Starts the server-side pipeline over the appliance's own inbox folder.
    localCapable: false,
    phrases: ['Import everything in the inbox', 'Import $unit from the inbox'],
    description:
      'Start one import run per unit waiting in the import inbox. Pass relative paths from ' +
      'import.scan_inbox as units, or omit units to import everything not already running. ' +
      'Inbox contents are copies the importer owns: each unit is REMOVED from the folder as its ' +
      'run consumes it (kept for retry if the run fails). Runs continue in the background — ' +
      'follow them with import.run_status.',
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        units: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Relative paths from import.scan_inbox. Omit to import every unit the scan yields ' +
            'that is not already being imported.',
        },
        label: {
          type: 'string',
          description: 'Display name applied to each started run. Defaults per unit to its filename.',
        },
      },
    },
  };

  constructor(
    private readonly inbox: ImportInboxService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(ImportInboxTool.name);
  }

  protected async executeInternal(context: ToolExecutionContext, input: ImportInboxInput) {
    if (!context.userId) {
      throw new Error('An authenticated user is required to import');
    }

    let results;

    try {
      ({ results } = await this.inbox.startBatch(
        { userId: context.userId },
        { units: input?.units, label: input?.label ?? null, source: 'mcp' },
      ));
    } catch (err) {
      if (err instanceof BadRequestException) {
        // Returned rather than thrown — an agent can act on "too many units,
        // import a subset", where a tool error reads as a malfunction.
        return { started: false, reason: err.message };
      }

      throw err;
    }

    const started = results.filter((result) => result.runId != null);

    this.logger.log('Started inbox batch from a tool call', {
      userId: context.userId,
      started: started.length,
      failed: results.length - started.length,
    });

    return {
      started: started.length > 0,
      results,
      note:
        'Each started unit imports in the background as its own run — follow them with ' +
        'import.run_status. Started units are removed from the inbox as their runs consume them.',
    };
  }
}
