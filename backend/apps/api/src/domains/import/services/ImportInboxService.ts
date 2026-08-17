import { Dirent } from 'node:fs';
import { chmod, lstat, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';

import { BadRequestException, Injectable } from '@nestjs/common';

import type { UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';

import { dataSourcesRecognize, type DirEntry } from '../datasources/registry';
import type { ImportRunSource } from '../entities/ImportRunEntity';
import { inboxRoot, resolveWithinInbox } from '../sources/importRoots';

import { ImportRunService } from './ImportRunService';
import { StagedSourceService } from './StagedSourceService';

/** A directory is one unit when an importer is at least this sure of it. */
const UNIT_CONFIDENCE = 0.5;

/** Walk ceilings. Exceeding any sets `truncated`, never errors. */
const MAX_DEPTH = 6;
const MAX_ENTRIES = 20_000;
const MAX_UNITS = 500;

/**
 * The batch ceiling. A request over it is REJECTED, not truncated — silently
 * importing 100 of 130 units reads as "imported everything" to the person who
 * asked for everything.
 */
export const MAX_INBOX_BATCH_UNITS = 100;

/** Desktop litter that is never an export. */
const JUNK_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export interface InboxUnitRecognition {
  dataSource: string;
  title: string;
  confidence: number;
}

/** One importable thing the scan found — a file, or a whole recognized directory. */
export interface InboxUnit {
  /** POSIX path relative to the inbox root: the handle a client sends back. */
  path: string;
  kind: 'file' | 'directory';
  sizeBytes: number;
  fileCount: number;
  recognized: InboxUnitRecognition[];
  /**
   * An unfinished run of THIS user's already consuming the unit, if any.
   * Null when the claim belongs to someone else — see {@link claimed}, which
   * is the field to test before offering a unit for import.
   */
  activeRunId: string | null;
  /**
   * Some run holds this unit, whoever started it.
   *
   * The inbox is one folder shared by every account on the appliance, so
   * "already being imported" is not a per-user fact. Reporting only the
   * caller's own claims let two accounts start runs over the same archive, and
   * the unpack acquires by RENAME — the winner took the bytes and the loser
   * found an empty path. Another user's run id is deliberately not exposed;
   * this boolean is all a client needs to know the unit is unavailable.
   */
  claimed: boolean;
}

export interface InboxScan {
  available: boolean;
  reason?: string;
  inboxDir: string;
  units: InboxUnit[];
  skippedSymlinks: number;
  truncated: boolean;
}

export interface InboxUnitResult {
  unit: string;
  runId?: string;
  label?: string;
  error?: string;
}

export interface InboxBatchResult {
  results: InboxUnitResult[];
}

export interface StartInboxBatchInput {
  /** Relative paths from a scan. Omitted means every unit the scan yields. */
  units?: readonly string[];
  label?: string | null;
  source: ImportRunSource;
}

/**
 * The inbox surface: what is waiting in the folder, and turning it into runs.
 *
 * Two properties carry the safety story. Every path leaving or entering this
 * service resolves through `resolveWithinInbox` — the consume-side resolver —
 * so nothing under CI_IMPORT_ROOTS can reach the claim, the move, or the
 * delete. And the walk NEVER follows symlinks: a consume-and-delete folder
 * must not reach through a link to bytes it does not own, so links are counted
 * and skipped rather than adjudicated.
 */
@Injectable()
export class ImportInboxService {
  constructor(
    private readonly runs: ImportRunService,
    private readonly stagedSources: StagedSourceService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ImportInboxService.name);
  }

  /**
   * Walk the inbox and report its units.
   *
   * A regular file is a unit. A directory an importer recognizes with
   * confidence ≥ {@link UNIT_CONFIDENCE} is ONE unit, whole subtree — an
   * unzipped Takeout must not shatter into thousands of file-units — and an
   * unrecognized directory is recursed into as mere organization. Deterministic
   * (lexicographic) so two scans of an unchanged inbox agree.
   */
  async scan(ctx: UserServiceContext): Promise<InboxScan> {
    const inboxDir = inboxRoot();

    try {
      // Best-effort: on the shipped mount this is a no-op; on a read-only or
      // absent mount it fails and the readdir below reports why.
      //
      // A freshly-created inbox is made world-writable with the sticky bit —
      // /tmp's answer to this exact problem. The api container runs as root,
      // so without this the folder lands on the host root-owned 755 and the
      // desktop user cannot move archives in, which is the entire point of the
      // folder. Safe because the inbox only ever holds COPIES the importer
      // consumes; the sticky bit keeps one local user from removing another's.
      // Only on creation: an operator who tightened the mode afterwards stays
      // tightened. The mkdir mode argument is masked by umask, hence the
      // explicit chmod.
      const existed = await lstat(inboxDir).then(
        () => true,
        () => false,
      );

      if (!existed) {
        await mkdir(inboxDir, { recursive: true });
        await chmod(inboxDir, 0o1777).catch(() => undefined);
      }

      await readdir(inboxDir);
    } catch (err: unknown) {
      return {
        available: false,
        reason: `The inbox directory is not readable: ${(err as Error).message}`,
        inboxDir,
        units: [],
        skippedSymlinks: 0,
        truncated: false,
      };
    }

    const state = { entries: 0, symlinks: 0, truncated: false };
    const units: InboxUnit[] = [];

    await this.walk(inboxDir, inboxDir, 0, state, units);

    // Every live claim on these paths, not just this user's — the folder is
    // shared, so a unit another account is importing is gone for this one too.
    const active = await this.stagedSources.findActiveByPaths(
      units.map((unit) => path.join(inboxDir, unit.path)),
    );
    const claimedBy = new Map(active.map((row) => [row.sourcePath, row]));

    for (const unit of units) {
      const claim = claimedBy.get(path.join(inboxDir, unit.path));

      unit.claimed = claim != null;
      // The run id only when it is theirs to look at. A client uses it to open
      // the run; another user's would 404 there and disclose that the run
      // exists on the way.
      unit.activeRunId = claim != null && claim.userId === ctx.userId ? claim.runId : null;
    }

    return {
      available: true,
      inboxDir,
      units,
      skippedSymlinks: state.symlinks,
      truncated: state.truncated,
    };
  }

  /**
   * Start one run per unit. Per-unit isolation is the contract: a unit that
   * fails to start records its error in the results and its siblings proceed,
   * because "one bad archive aborted the other forty" is the batch equivalent
   * of failing a whole import over one unreadable file.
   */
  async startBatch(ctx: UserServiceContext, input: StartInboxBatchInput): Promise<InboxBatchResult> {
    let requested: readonly string[];

    if (input.units == null) {
      const scanned = await this.scan(ctx);

      if (!scanned.available) {
        throw new BadRequestException(scanned.reason ?? 'The inbox is not available');
      }

      requested = scanned.units.filter((unit) => !unit.claimed).map((unit) => unit.path);
    } else {
      requested = input.units;
    }

    if (requested.length > MAX_INBOX_BATCH_UNITS) {
      throw new BadRequestException(
        `A batch starts at most ${MAX_INBOX_BATCH_UNITS} imports; this one names ${requested.length}. ` +
          `Import a subset, then the rest.`,
      );
    }

    const inboxDir = inboxRoot();
    const results: InboxUnitResult[] = [];

    for (const unit of requested) {
      try {
        const resolved = await resolveWithinInbox(path.join(inboxDir, unit));
        const info = await lstat(resolved);

        if (info.isSymbolicLink()) {
          throw new Error('Symbolic links are not importable');
        }

        const kind = info.isDirectory() ? 'directory' : 'file';
        const sizeBytes =
          kind === 'file' ? info.size : (await this.aggregate(resolved, { entries: 0 })).sizeBytes;

        const { run } = await this.runs.startRun(ctx, {
          localSource: { path: resolved, kind, sizeBytes },
          label: input.label ?? null,
          source: input.source,
        });

        results.push({ unit, runId: run.id, label: run.label ?? undefined });
      } catch (err: unknown) {
        results.push({ unit, error: (err as Error).message });
      }
    }

    this.logger.log('Started inbox batch', {
      userId: ctx.userId,
      requested: requested.length,
      started: results.filter((result) => result.runId != null).length,
    });

    return { results };
  }

  private async walk(
    inboxDir: string,
    dir: string,
    depth: number,
    state: { entries: number; symlinks: number; truncated: boolean },
    units: InboxUnit[],
  ): Promise<void> {
    if (depth > MAX_DEPTH || units.length >= MAX_UNITS) {
      state.truncated = true;

      return;
    }

    let entries: Dirent[];

    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // A subdirectory that vanished mid-scan (a batch consumed it) is not an
      // error; the next scan will not see it either.
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (units.length >= MAX_UNITS || state.entries >= MAX_ENTRIES) {
        state.truncated = true;

        return;
      }

      state.entries += 1;

      if (entry.isSymbolicLink()) {
        state.symlinks += 1;
        continue;
      }

      if (JUNK_NAMES.has(entry.name) || entry.name.startsWith('.')) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      const relative = path.relative(inboxDir, fullPath).split(path.sep).join('/');

      if (entry.isFile()) {
        const info = await lstat(fullPath);

        units.push({
          path: relative,
          kind: 'file',
          sizeBytes: info.size,
          fileCount: 1,
          recognized: await this.recognize(fullPath),
          activeRunId: null,
          claimed: false,
        });
        continue;
      }

      if (!entry.isDirectory()) {
        continue;
      }

      const recognized = await this.recognize(fullPath);

      if (recognized.length > 0 && recognized[0].confidence >= UNIT_CONFIDENCE) {
        const aggregate = await this.aggregate(fullPath, state);

        units.push({
          path: relative,
          kind: 'directory',
          sizeBytes: aggregate.sizeBytes,
          fileCount: aggregate.fileCount,
          recognized,
          activeRunId: null,
          claimed: false,
        });
        continue;
      }

      await this.walk(inboxDir, fullPath, depth + 1, state, units);
    }
  }

  private async recognize(target: string): Promise<InboxUnitRecognition[]> {
    const entry: DirEntry = {
      filename: path.basename(target),
      fullPath: target,
      fsRoot: target,
    };

    try {
      const matches = await dataSourcesRecognize(undefined, entry, {}, { descend: true });

      return matches
        .sort((a, b) => b.recognition.confidence - a.recognition.confidence)
        .map((match) => ({
          dataSource: match.data_source.name,
          title: match.data_source.title,
          confidence: match.recognition.confidence,
        }));
    } catch (err: unknown) {
      // Recognition is advisory on this surface; a parser that chokes on a
      // half-written file must not hide the unit from the listing.
      this.logger.debug('Recognition failed during inbox scan', {
        target: path.basename(target),
        error: (err as Error).message,
      });

      return [];
    }
  }

  /** Recursive size/count for a directory unit, bounded by the walk's entry cap. */
  private async aggregate(
    dir: string,
    state: { entries: number },
  ): Promise<{ sizeBytes: number; fileCount: number }> {
    let sizeBytes = 0;
    let fileCount = 0;

    let entries: Dirent[];

    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return { sizeBytes, fileCount };
    }

    for (const entry of entries) {
      if (state.entries >= MAX_ENTRIES) {
        break;
      }

      state.entries += 1;

      if (entry.isSymbolicLink()) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);

      if (entry.isFile()) {
        try {
          sizeBytes += (await lstat(fullPath)).size;
          fileCount += 1;
        } catch {
          // Vanished mid-walk; the aggregate is advisory.
        }
      } else if (entry.isDirectory()) {
        const nested = await this.aggregate(fullPath, state);

        sizeBytes += nested.sizeBytes;
        fileCount += nested.fileCount;
      }
    }

    return { sizeBytes, fileCount };
  }
}
