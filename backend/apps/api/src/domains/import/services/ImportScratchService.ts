import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { Injectable } from '@nestjs/common';

import { LoggerService } from '@ci/common/logging';
import config from '@ci/configuration';

/**
 * The working directory a run owns, from first byte to cleanup.
 *
 * A run's stages are separate jobs on separate workers, so the tree `unpack`
 * produces has to outlive the job that produced it and be findable by the job
 * that reads it. Deriving the path from the run id rather than minting a temp
 * directory is what makes that work across a restart: a worker that picks up
 * `parse` after a crash resolves the same directory `unpack` filled, and finds
 * the extracted tree still there.
 *
 * It is also the reason cleanup is explicit. Nothing here is reclaimed by the
 * OS — these directories hold tens of gigabytes, under `config.import.scratchDir`
 * rather than `/tmp`, which is tmpfs on a stock appliance and would consume RAM
 * until the machine died.
 */
@Injectable()
export class ImportScratchService {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext(ImportScratchService.name);
  }

  /**
   * The run's directory, created if absent.
   *
   * Scoped by user then run so a stray directory names its owner, and so the
   * whole of one person's importer scratch can be reclaimed with one path.
   */
  async ensureDir(userId: string, runId: string): Promise<string> {
    const dir = this.dirFor(userId, runId);

    await mkdir(dir, { recursive: true });

    return dir;
  }

  /** The run's directory path. Pure — makes nothing, touches nothing. */
  dirFor(userId: string, runId: string): string {
    return path.join(config.import.scratchDir, userId, runId);
  }

  /** Bytes currently held under the run's directory, or 0 when there is none. */
  async exists(userId: string, runId: string): Promise<boolean> {
    try {
      const info = await stat(this.dirFor(userId, runId));

      return info.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Reclaim a run's directory.
   *
   * Best-effort: a failure here is disk left behind, never a failed import, so
   * it is logged rather than thrown. The alternative — failing a finished run
   * because its scratch could not be removed — reports a successful import as
   * broken, which is the worse of the two.
   */
  async reclaim(userId: string, runId: string): Promise<boolean> {
    const dir = this.dirFor(userId, runId);

    try {
      await rm(dir, { recursive: true, force: true });

      return true;
    } catch (err) {
      this.logger.warn('Failed to reclaim import scratch directory', {
        dir,
        runId,
        error: (err as Error).message,
      });

      return false;
    }
  }
}
