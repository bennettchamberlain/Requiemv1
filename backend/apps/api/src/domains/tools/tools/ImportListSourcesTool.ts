import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { DataSourceCatalogService } from '@ci/domains/import';

import { BaseTool } from '../core/BaseTool';
import type { IntentDefinition, ToolExecutionContext } from '../core/types';


interface ListSourcesInput {
  /** Narrow to sources whose name, title or description matches. */
  query?: string;
  /** Include the authored export instructions. Off by default — they are long. */
  includeGuide?: boolean;
}

/**
 * What this appliance can import, for an agent.
 *
 * The same catalogue the Import page reads, so an assistant answering "can you
 * import my Spotify history?" and the page listing sources cannot disagree.
 *
 * `includeGuide` is off by default because the guides are paragraphs of authored
 * instructions and an agent asking "what is supported?" wants a list, not a
 * manual. It exists because the follow-up question — "how do I get it?" — is
 * exactly the one the guides answer, and an agent that can read them out is more
 * useful than one that links to a page.
 */
@Injectable()
export class ImportListSourcesTool extends BaseTool<ListSourcesInput, unknown> {
  readonly schema: IntentDefinition = {
    name: 'import.list_sources',
    domain: 'import',
    title: 'List importable sources',
    privacy: { access: 'read', sensitivity: 'low', destructive: false, external: false },
    // The importer registry lives in the server process; the device mirrors records, not importers.
    localCapable: false,
    phrases: [
      'What can you import',
      'Can you import my $service data',
      'How do I export my $service data',
    ],
    description:
      'List every export this appliance can read, with a short description and whether it supports ' +
      'file or API import. Optionally include the authored step-by-step instructions for obtaining ' +
      'that export from the service that holds it.',
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Filter to sources matching this text in their name, title or description.',
        },
        includeGuide: {
          type: 'boolean',
          description:
            'Include the export instructions for each source. Verbose; use when the user is asking how to obtain an export.',
          default: false,
        },
      },
    },
  };

  constructor(
    private readonly catalog: DataSourceCatalogService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(ImportListSourcesTool.name);
  }

  protected async executeInternal(_context: ToolExecutionContext, input: ListSourcesInput) {
    const needle = input?.query?.trim().toLowerCase();

    const matches = this.catalog.list().filter((source) => {
      if (!needle) {
        return true;
      }

      return (
        source.name.toLowerCase().includes(needle) ||
        source.title.toLowerCase().includes(needle) ||
        source.description.toLowerCase().includes(needle)
      );
    });

    return {
      total: matches.length,
      sources: matches.map((source) => ({
        name: source.name,
        title: source.title,
        description: source.description,
        // Kept, because "we know this format and have not finished it" is a
        // materially different answer from silence.
        implemented: !source.stub,
        supportsFiles: source.supportsFiles,
        supportsApi: source.supportsApi,
        ...(input?.includeGuide ? { guide: source.guide } : {}),
      })),
    };
  }
}
