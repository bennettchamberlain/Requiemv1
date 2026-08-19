import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { ImportInboxService } from '@ci/domains/import';

import { BaseTool } from '../core/BaseTool';
import type { IntentDefinition, ToolExecutionContext } from '../core/types';

/**
 * What is waiting in the import inbox.
 *
 * The inbox is the folder a user moves export archives into — the batch
 * alternative to uploading each one. This tool answers "what would a batch
 * import act on?": each unit with its kind, size, per-importer recognition,
 * and whether a run is already consuming it. The relative paths it returns are
 * the handles `import.import_inbox` takes.
 *
 * Read-only: nothing is claimed, moved, or imported by scanning.
 */
@Injectable()
export class ImportScanInboxTool extends BaseTool<Record<string, never>, unknown> {
  readonly schema: IntentDefinition = {
    name: 'import.scan_inbox',
    domain: 'import',
    title: 'Scan the import inbox',
    privacy: { access: 'read', sensitivity: 'personal', destructive: false, external: false },
    // Walks a folder on the appliance's disk with the server's importer registry.
    localCapable: false,
    phrases: ['What is waiting in the import inbox', 'Scan the inbox for exports'],
    description:
      'List what is waiting in the import inbox folder: files and recognized export directories, ' +
      'each with size, recognition, and whether an import is already running for it. The returned ' +
      'relative paths are the units import.import_inbox accepts. Reads only; imports nothing.',
    category: 'database',
    parameters: { type: 'object', properties: {} },
  };

  constructor(
    private readonly inbox: ImportInboxService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(ImportScanInboxTool.name);
  }

  protected async executeInternal(context: ToolExecutionContext) {
    if (!context.userId) {
      throw new Error('An authenticated user is required to scan the inbox');
    }

    const scan = await this.inbox.scan({ userId: context.userId });

    return {
      ...scan,
      note: scan.available
        ? 'Import these with import.import_inbox, passing the relative paths as units.'
        : 'The inbox folder is not available on this appliance.',
    };
  }
}
