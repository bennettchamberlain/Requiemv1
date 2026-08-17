import { Command } from 'commander';

import { ImportApiClient } from './client';
import { backfillCommand } from './commands/backfill';
import { dataSourcesCommand } from './commands/datasources';
import { importCommand } from './commands/import';
import { inboxCommand } from './commands/inbox';
import { pushCommand } from './commands/push';
import { recognizeCommand } from './commands/recognize';
import { runsCommand } from './commands/runs';
import { statsCommand } from './commands/stats';
import type { CliContext } from './context';
import type { Term } from './output';

/** Where the appliance is, when nobody says. The API's own default port. */
export const DEFAULT_SERVER_URL = 'http://localhost:3030';

export interface GlobalOptions {
  server?: string;
  apiKey?: string;
}

export interface ProgramDeps {
  term: Term;
  /** Injected so tests drive the commands without a socket. */
  makeClient?: (options: GlobalOptions) => ImportApiClient;
  version?: string;
}

/**
 * Resolve where to talk and what to prove.
 *
 * Flag beats environment beats default, and the api key has no default at all:
 * a CLI that silently tried an empty credential would turn "you have not set
 * CI_API_KEY" into an opaque 401 from a route the user has never heard of.
 * `CI_SERVER_API_KEY` is accepted alongside `CI_API_KEY` because both spellings
 * are in use in the surrounding tooling.
 */
export function resolveTarget(
  options: GlobalOptions,
  env: NodeJS.ProcessEnv = process.env,
): { baseUrl: string; apiKey: string | null } {
  return {
    baseUrl: options.server ?? env.CI_SERVER_URL ?? DEFAULT_SERVER_URL,
    apiKey: options.apiKey ?? env.CI_API_KEY ?? env.CI_SERVER_API_KEY ?? null,
  };
}

/**
 * `ci-import` — the import domain at the command line.
 *
 * Every command is an HTTP call to a running appliance; see {@link
 * ImportApiClient} for why it is a client rather than an embedded Nest context.
 * The commands themselves take a {@link CliContext} and know nothing about
 * argument parsing, which is what lets the tests exercise them directly and
 * lets this file stay a wiring diagram.
 */
export function buildProgram(deps: ProgramDeps): Command {
  const program = new Command();

  const context = (): CliContext => {
    const options = program.opts<GlobalOptions>();
    const target = resolveTarget(options);

    return {
      term: deps.term,
      client: deps.makeClient
        ? deps.makeClient(options)
        : new ImportApiClient({ baseUrl: target.baseUrl, apiKey: target.apiKey }),
    };
  };

  program
    .name('ci-import')
    .description('Import bulk exports into this Companion Intelligence appliance.')
    .version(deps.version ?? '0.0.0')
    .option('--server <url>', 'CI-Server base URL [CI_SERVER_URL]')
    .option('--api-key <key>', 'API key for the appliance [CI_API_KEY]')
    // Commander prints its own help/errors; routing them through the Term keeps
    // every byte this CLI emits testable through one seam.
    .configureOutput({
      writeOut: (text) => deps.term.out(text.replace(/\n$/, '')),
      writeErr: (text) => deps.term.err(text.replace(/\n$/, '')),
    })
    .showHelpAfterError();

  program
    .command('datasources')
    .description('List the importers this appliance ships (71 of them), or the services they cover')
    .option('--catalog', 'list authored services instead of parsers, including ones not yet built')
    .option('--json', 'machine-readable output')
    .action((options) => dataSourcesCommand(context(), options));

  program
    .command('recognize')
    .argument('<path>', 'path on the APPLIANCE, within CI_IMPORT_ROOTS or the inbox')
    .description('Ask every parser what it makes of a path, importing nothing')
    .option('--json', 'machine-readable output')
    .action((path: string, options) => recognizeCommand(context(), path, options));

  program
    .command('import')
    .argument('<path...>', 'archive file(s) on THIS machine')
    .description('Upload archives and run them through unpack → parse → media → push')
    .option('--label <label>', 'display name for the run; defaults to the filename')
    .option('--stages <list>', 'comma-separated stages to run; default is all four')
    .option('--wait', 'follow the runs until they finish')
    .option('--timeout <seconds>', 'give up waiting after this long')
    .option('--json', 'machine-readable output')
    .action((paths: string[], options) => importCommand(context(), paths, options));

  program
    .command('inbox')
    .description('Show what is waiting in the import inbox, and import it')
    .option('--start', 'import the units (the inbox CONSUMES what it imports)')
    .option('--only <sources>', 'keep units recognized as these data sources')
    .option('--skip <sources>', 'drop units recognized as these data sources')
    .option('--units <paths>', 'exact unit paths from a scan')
    .option('--label <label>', 'display name for the runs')
    .option('--wait', 'follow the runs until they finish')
    .option('--timeout <seconds>', 'give up waiting after this long')
    .option('--json', 'machine-readable output')
    .action((options) => inboxCommand(context(), options));

  program
    .command('runs')
    .argument('[runId]', 'a run id, for its stage bar')
    .description('Import runs and their progress')
    .option('--limit <n>', 'how many runs to list')
    .option('--wait', 'follow the run until it finishes')
    .option('--timeout <seconds>', 'give up waiting after this long')
    .option('--json', 'machine-readable output')
    .action((runId: string | undefined, options) => runsCommand(context(), runId, options));

  program
    .command('push')
    .description('Push staged rows into ci.* — the deferred half of an import')
    .option('--run <id>', 'restrict to this run (repeatable)', collect, [])
    .option('--dry-run', 'list what would be pushed')
    .option('--wait', 'follow the runs until they finish')
    .option('--timeout <seconds>', 'give up waiting after this long')
    .option('--json', 'machine-readable output')
    .action((options) => pushCommand(context(), options));

  program
    .command('stats')
    .description('Row counts in ci.*, search-index coverage, and a rollup of this account’s runs')
    .option('--json', 'machine-readable output')
    .action((options) => statsCommand(context(), options));

  program
    .command('backfill')
    .argument('[stages...]', 'legs to run; none means all of them')
    .description('Run the post-import enrichment chain')
    .option('--list', 'show the legs and what each does')
    .option('--abort-on-error', 'stop at the first failing leg instead of carrying on')
    .option('--json', 'machine-readable output')
    .action((stages: string[], options) => backfillCommand(context(), stages, options));

  // Short lines on purpose: commander re-wraps long ones to the terminal width,
  // and a paragraph that already contains newlines comes out ragged.
  program.addHelpText(
    'after',
    [
      '',
      'Every command is an HTTP call to a running CI-Server, so a run started',
      'here is the same run the web wizard starts.',
      '',
      'Configuration:',
      `  CI_SERVER_URL   where the appliance is [${DEFAULT_SERVER_URL}]`,
      '  CI_API_KEY      an api key; create one in the web UI under',
      '                  Settings → API keys',
      '',
      'Examples:',
      '  ci-import datasources',
      '  ci-import recognize /srv/exports/Takeout',
      '  ci-import import ~/Downloads/takeout-1.zip --wait',
      '  ci-import inbox',
      '  ci-import inbox --start --only google_photos --wait',
      '  ci-import runs',
      '  ci-import backfill --list',
    ].join('\n'),
  );

  return program;
}

/** Commander's repeatable-option accumulator. */
function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
