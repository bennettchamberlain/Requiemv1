import path from 'node:path';

import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { LoggerService } from '@ci/common/logging';

import { dataSourcesRecognize, type DataSourceRecognition, type DirEntry } from '../datasources/registry';
import { StagedWriter, type StagedCounts } from '../staging/StagedWriter';
import type { ImportStageRunner, StageOutcome, StageRunContext } from '../types';

/**
 * Read the unpacked tree and stage what is in it.
 *
 * Recognition first, then one parser per recognized source. A Google Takeout is
 * not "a Takeout" to the importer — it is Mail, Photos, Location History and
 * Chrome history sitting in one folder, each with its own parser, and each
 * staging under its own `data_source` so the push and every downstream dedup can
 * tell them apart.
 *
 * ## One bad parser does not fail the import
 *
 * A parser that throws is caught, recorded against its source, and the stage
 * moves to the next one. The run ends `partial` — terminal, success-ish — with
 * the failures in the stage detail. Five of six sources imported is five more
 * than a run that aborted on the first exception, and the alternative teaches
 * people to re-upload 40GB because one parser met a file it disliked.
 */
/** The catch-all importer's registered name (datasources/generic.ts). */
const GENERIC_DATA_SOURCE = 'generic';

@Injectable()
export class ParseStage implements ImportStageRunner {
  readonly kind = 'parse' as const;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ParseStage.name);
  }

  async run(context: StageRunContext): Promise<StageOutcome> {
    await context.progress({ processed: 0, total: null, phase: 'recognizing' });

    const recognized = await this.recognize(context.scratchDir);

    if (recognized.length === 0) {
      // Not an error. A person can upload something this appliance has no parser
      // for, and the honest report is "nothing here I know how to read" rather
      // than a failure that implies their file was broken.
      return {
        processed: 0,
        total: 0,
        partial: true,
        detail: { recognized: [], reason: 'no recognized data sources in the uploaded tree' },
      };
    }

    const perSource: Array<Record<string, unknown>> = [];
    const failures: Array<{ dataSource: string; error: string }> = [];
    let staged = 0;

    for (const [index, match] of recognized.entries()) {
      const name = match.data_source.name;

      await context.progress({
        processed: staged,
        total: null,
        phase: `parsing ${name} (${index + 1}/${recognized.length})`,
      });

      try {
        const counts = await this.parseOne(context, match);

        staged += counts.items + counts.entities;
        perSource.push({ dataSource: name, ...counts });
      } catch (err) {
        const error = (err as Error).message;

        failures.push({ dataSource: name, error });
        this.logger.warn('Parser failed; continuing with the other sources', {
          runId: context.runId,
          dataSource: name,
          error,
        });
      }
    }

    await this.recordDataSources(context.runId, perSource);

    return {
      processed: staged,
      total: staged,
      partial: failures.length > 0,
      detail: {
        recognized: recognized.map((match) => match.data_source.name),
        sources: perSource,
        failures,
      },
    };
  }

  /**
   * Stamp the run with the services it turned out to contain, via
   * {@link rankDataSources}.
   *
   * On the run itself rather than left in this stage's `detail`, because the run
   * LIST is what needs it — naming a run in a list of ten should not mean
   * joining ten stage rows and parsing their JSON.
   *
   * Ordered by row count, so the first name is the one the archive is mostly
   * about; a `generic` fallback that matched a stray CSV sorts to the end
   * instead of leading. Ties break on name so a re-parse is stable.
   *
   * Sources that produced NOTHING are dropped: a parser recognising a file and
   * then finding no rows in it is not something the run was.
   */
  private async recordDataSources(
    runId: string,
    perSource: ReadonlyArray<Record<string, unknown>>,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE ci_import.import_runs SET data_sources = $2::text[] WHERE id = $1::uuid`,
      [runId, rankDataSources(perSource)],
    );
  }

  /**
   * Which importers claim anything under the run's tree.
   *
   * `descend: true` because the tree is whatever the archive contained: a bare
   * `.gpx` sitting one level down is the single-file drag-and-drop case, and
   * without descent the containing folder matches nothing at all.
   */
  private async recognize(scratchDir: string): Promise<DataSourceRecognition[]> {
    const entry: DirEntry = {
      filename: path.basename(scratchDir),
      fullPath: scratchDir,
      fsRoot: scratchDir,
    };

    const matches = await dataSourcesRecognize(undefined, entry, {}, { descend: true });

    return this.dropGenericWhenSpecialised(matches);
  }

  /**
   * Drop the catch-all when a real parser claimed the tree.
   *
   * `generic` returns `confidence: 1` unconditionally without inspecting
   * anything, so it matches every archive — and because this stage runs EVERY
   * recognized source, it then re-read everything the specialised parsers had
   * already read. On a real Google Takeout that produced 80,067 duplicate
   * staged rows next to 309,689 Google Voice ones, with 67,065 filenames
   * overlapping exactly. They push as contentless `ci.content` rows (no text,
   * no url, no file, no event), and since `ci.content` carries no time column
   * they sort ahead of every genuine memory — so the default Memory view became
   * 80k empty stubs, and per-source counts were inflated 17.5%.
   *
   * Upstream made this selection in its drop zone
   * (`cands.filter(c => c.dataSource !== 'generic')`); the selection layer was
   * not ported, and no API can deselect an importer. Generic stays as the SOLE
   * match, which is what makes dragging a bare `.gpx` or a loose PDF still work.
   */
  private dropGenericWhenSpecialised(matches: DataSourceRecognition[]): DataSourceRecognition[] {
    const specialised = matches.filter((match) => match.data_source.name !== GENERIC_DATA_SOURCE);

    return specialised.length > 0 ? specialised : matches;
  }

  /** Run one importer, staging everything it emits. */
  private async parseOne(context: StageRunContext, match: DataSourceRecognition): Promise<StagedCounts> {
    const name = match.data_source.name;
    const importer = match.data_source.newFileImporter?.();

    if (importer == null) {
      throw new Error(`${name} recognized the tree but has no file importer`);
    }

    const writer = new StagedWriter(this.dataSource.manager, {
      userId: context.userId,
      runId: context.runId,
      dataSource: name,
    });

    // The path that actually matched, not the scratch root: recognition may have
    // found this source several levels down, and running it against the root
    // makes it re-scan the whole tree to find what it already located.
    const matchedPath = match.matchedPath ?? context.scratchDir;
    const entry: DirEntry = {
      filename: path.basename(matchedPath),
      fullPath: matchedPath,
      fsRoot: context.scratchDir,
    };

    await importer.fileImport(undefined, entry, {
      pipeline: writer,
      // Where datasources that materialise bytes (MMS parts in
      // `sms_backup_restore`) are allowed to write them. Left unset they fall
      // back to `os.tmpdir()`, which is exactly the hazard `configuration.ts`
      // and `ImportScratchService` both call out: `/tmp` is tmpfs on a stock
      // appliance, so a large export would consume RAM until the machine died —
      // and nothing sweeps it, because the purge cron owns `uploadsDir` and the
      // scratch service owns `scratchDir`. Pointing it at this run's scratch
      // puts those bytes under the reclaim that already runs when the run ends.
      mediaStoreDir: context.scratchDir,
      log: (level, message, meta) => {
        if (level === 'error' || level === 'warn') {
          this.logger.warn(message, { runId: context.runId, dataSource: name, ...meta });
        }
      },
    });

    // The parser is done producing; everything it pushed still has to land.
    await writer.settled();

    const counts = writer.totals;

    this.logger.log('Staged a data source', { runId: context.runId, dataSource: name, ...counts });

    return counts;
  }
}

/**
 * The services a run should be labelled with, most rows first.
 *
 * Ordered by row count so the first name is the one the archive is mostly
 * about: a `generic` fallback that matched a stray CSV sorts to the end rather
 * than leading a list that should say "Audible". Ties break on name so a
 * re-parse produces the same order.
 *
 * Sources that produced NOTHING are dropped. A parser recognising a file and
 * then finding no rows in it is not something the run was — and `recognized`
 * in the stage detail still records that it matched, for anyone debugging why
 * a file went nowhere.
 */
export function rankDataSources(perSource: ReadonlyArray<Record<string, unknown>>): string[] {
  return perSource
    .map((entry) => ({
      name: String(entry.dataSource ?? ''),
      rows: Number(entry.items ?? 0) + Number(entry.entities ?? 0),
    }))
    .filter((entry) => entry.name.length > 0 && entry.rows > 0)
    .sort((a, b) => b.rows - a.rows || a.name.localeCompare(b.name))
    .map((entry) => entry.name);
}
