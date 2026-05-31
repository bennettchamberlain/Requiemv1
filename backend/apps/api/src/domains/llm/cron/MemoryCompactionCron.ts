/**
 * MemoryCompactionCron
 *
 * Runs every 5 minutes (feature-flagged: 'agent.memory.compaction').
 * Fetches all unprocessed note fragments across all users, groups them
 * by user, and delegates each user's batch to MemoryCompactionService.
 *
 * Design constraints:
 * - At most 100 notes per cron tick to bound latency.
 * - Per-user failures are caught and logged so one user can't block others.
 * - Notes at least 2 minutes old are eligible (lets write bursts settle).
 */

import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';

import { SYSTEM_USER, type ServiceContext } from '@ci/common/context';
import { FeatureService } from '@ci/common/feature';
import { LoggerService } from '@ci/common/logging';
import { Cron } from '@ci/common/schedule';
import { NoteService, type Note } from '@ci/domains/notes';

import { MemoryCompactionService } from '../services/MemoryCompactionService';

const NOTES_PER_TICK = 100;

@Injectable()
export class MemoryCompactionCron {
  constructor(
    private readonly compactionService: MemoryCompactionService,
    private readonly noteService: NoteService,
    private readonly featureService: FeatureService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(MemoryCompactionCron.name);
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async cronCompactMemories(): Promise<void> {
    const featureEnabled = await this.featureService.isFeatureEnabled('agent.memory.compaction');

    if (!featureEnabled) {
      return;
    }

    this.logger.log('Memory compaction cron starting');

    // Query unprocessed fragments across ALL users (SYSTEM_USER skips userId filter).
    const systemContext = { userId: SYSTEM_USER } as ServiceContext;

    const notes = await this.noteService.findUnprocessed(systemContext, {
      limit: NOTES_PER_TICK,
      minAgeMinutes: 2,
    });

    if (notes.length === 0) {
      this.logger.debug('No unprocessed memory fragments found');

      return;
    }

    // Group by userId so each user gets a coherent extraction batch.
    const byUser = new Map<string, Note[]>();

    for (const note of notes) {
      const bucket = byUser.get(note.userId) ?? [];
      bucket.push(note);
      byUser.set(note.userId, bucket);
    }

    this.logger.log('Processing memory fragments', {
      totalFragments: notes.length,
      userCount: byUser.size,
    });

    for (const [userId, userNotes] of byUser) {
      try {
        await this.compactionService.compactForUser(userId, userNotes);
      } catch (err) {
        this.logger.error(
          `Memory compaction failed for user ${userId}`,
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    this.logger.log('Memory compaction cron complete');
  }
}
