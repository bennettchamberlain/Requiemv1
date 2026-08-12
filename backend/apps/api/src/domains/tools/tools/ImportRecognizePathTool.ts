import path from 'node:path';

import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import { dataSourcesRecognize, type DirEntry } from '@ci/domains/import';
import { PathOutsideImportRootsError, resolveWithinImportRoots } from '@ci/domains/import';

import { BaseTool } from '../core/BaseTool';
import type { IntentDefinition, ToolExecutionContext } from '../core/types';


interface RecognizePathInput {
  path?: string;
}

/**
 * Ask every parser what it makes of a path.
 *
 * This is the one capability the REST surface deliberately does not have. There,
 * an archive is opaque bytes in object storage until a run unpacks it, so
 * recognition reports what the parse stage found. Here the caller already has
 * the files on a disk the appliance can see, so the question can be answered
 * directly — which is what makes an agent able to say "that folder looks like a
 * Google Takeout" before anything is imported.
 *
 * Scoped to the configured import roots. An unconstrained absolute path over an
 * API is a filesystem read primitive, and "which of these paths exists?" is
 * information on its own.
 */
@Injectable()
export class ImportRecognizePathTool extends BaseTool<RecognizePathInput, unknown> {
  readonly schema: IntentDefinition = {
    name: 'import.recognize_path',
    domain: 'import',
    title: 'Recognize an export on disk',
    privacy: { access: 'read', sensitivity: 'personal', destructive: false, external: false },
    // Probes a path on the appliance's disk with the server's importer registry.
    localCapable: false,
    phrases: ['What is in this folder', 'What kind of export is $path'],
    description:
      'Ask every registered importer to inspect a path the appliance can see and report how ' +
      'confident it is that this is its kind of data, highest first. Reads the files but imports ' +
      'nothing. Only paths under the configured import roots may be inspected.',
    category: 'database',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to a file or directory, within a configured import root.',
        },
      },
      required: ['path'],
    },
  };

  constructor(protected readonly logger: LoggerService) {
    super();
    this.logger.setContext(ImportRecognizePathTool.name);
  }

  protected async executeInternal(_context: ToolExecutionContext, input: RecognizePathInput) {
    if (!input?.path) {
      throw new Error('path is required');
    }

    let resolved: string;

    try {
      resolved = await resolveWithinImportRoots(input.path);
    } catch (err) {
      if (err instanceof PathOutsideImportRootsError) {
        // Returned rather than thrown: an agent can act on "not allowed, upload
        // instead", where a tool error reads as a malfunction.
        return { allowed: false, reason: err.message, recognized: [] };
      }

      throw err;
    }

    const entry: DirEntry = {
      filename: path.basename(resolved),
      fullPath: resolved,
      fsRoot: resolved,
    };

    // `descend` because the caller points at a folder they downloaded into, and
    // the export is usually a level or two inside it.
    const matches = await dataSourcesRecognize(undefined, entry, {}, { descend: true });

    return {
      allowed: true,
      path: resolved,
      recognized: matches
        .sort((a, b) => b.recognition.confidence - a.recognition.confidence)
        .map((match) => ({
          dataSource: match.data_source.name,
          title: match.data_source.title,
          confidence: match.recognition.confidence,
          matchedPath: match.matchedPath ?? resolved,
        })),
    };
  }
}
