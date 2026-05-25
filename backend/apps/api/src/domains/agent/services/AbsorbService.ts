import { Injectable } from '@nestjs/common';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { CommunicationService, CommunicationType } from '@ci/domains/memory';

import type { AbsorbDto, AbsorbResult } from '../types';

// How many characters to use when fingerprinting a message for dedup.
// Long enough to avoid false positives, short enough to be fast.
const FINGERPRINT_LENGTH = 500;

@Injectable()
export class AbsorbService {
  constructor(
    private readonly communicationService: CommunicationService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AbsorbService.name);
  }

  async absorb(context: UserServiceContext, dto: AbsorbDto): Promise<AbsorbResult> {
    try {
      const inserted = await this.doAbsorb(context, dto);

      return { ok: true, inserted };
    } catch (err) {
      this.logger.error(
        err instanceof Error ? err : new Error(String(err)),
        `Absorb failed for user ${context.userId} (sessionId=${dto.sessionId ?? 'none'}, messages=${dto.messages.length})`,
      );

      return { ok: false, inserted: 0 };
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async doAbsorb(context: UserServiceContext, dto: AbsorbDto): Promise<number> {
    // Fetch existing rows for this session so we can skip duplicates.
    const existing = dto.sessionId
      ? await this.communicationService.findByThreadId(context, dto.sessionId)
      : [];

    // Fingerprint = direction + first N chars of content.
    // Sufficient for dedup without needing a separate hash column.
    const seen = new Set(existing.map((row) => this.fingerprint(row.direction, row.content)));

    let inserted = 0;

    for (const msg of dto.messages) {
      // Skip system messages — they're internal Hermes context, not conversation content.
      if (msg.role === 'system') {
        continue;
      }

      const direction = msg.role === 'assistant' ? 'outbound' : 'inbound';
      const fp = this.fingerprint(direction, msg.content);

      if (seen.has(fp)) {
        continue; // already stored in a previous absorb for this session
      }

      await this.communicationService.create(context, {
        time: new Date(),
        communication_type: CommunicationType.CHAT,
        direction,
        content: msg.content,
        thread_id: dto.sessionId,
        subject: dto.sessionId,
        category: 'agent-conversation',
        summary: msg.content.slice(0, 500),
      });

      seen.add(fp);
      inserted++;
    }

    return inserted;
  }

  private fingerprint(direction: string, content: string): string {
    return `${direction}:${content.slice(0, FINGERPRINT_LENGTH)}`;
  }
}
